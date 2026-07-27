use serde::{ Deserialize, Serialize };
use uesave::{ Properties, Property, PropertyKey, Save, StructValue, ValueVec };

pub const DEFAULT_LIMIT: usize = 100;
pub const MAX_LIMIT: usize = 250;
const PREVIEW_CHARS: usize = 160;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum PathSegment {
    Property {
        name: String,
        index: u32,
    },
    StructField {
        name: String,
        index: u32,
    },
    ArrayIndex {
        index: usize,
    },
    SetIndex {
        index: usize,
    },
    MapEntry {
        index: usize,
    },
    MapKey {
        index: usize,
    },
    MapValue {
        index: usize,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ScalarType {
    Bool,
    Int8,
    Int16,
    Int32,
    Int64,
    UInt8,
    UInt16,
    UInt32,
    UInt64,
    Float,
    Double,
    String,
    Name,
    Enum,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", content = "value", rename_all = "camelCase")]
pub enum EditableScalarValue {
    Bool(bool),
    Int8(i8),
    Int16(i16),
    Int32(i32),
    Int64(String),
    UInt8(u8),
    UInt16(u16),
    UInt32(u32),
    UInt64(String),
    Float(f32),
    Double(f64),
    String(String),
    Name(String),
    Enum(String),
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InspectSaveNodeRequest {
    pub path: Vec<PathSegment>,
    #[serde(default)]
    pub offset: usize,
    pub limit: Option<usize>,
}

impl InspectSaveNodeRequest {
    pub fn page(&self) -> Result<(usize, usize), String> {
        let limit = self.limit.unwrap_or(DEFAULT_LIMIT);
        if limit == 0 {
            return Err("limit must be greater than zero".to_string());
        }
        if limit > MAX_LIMIT {
            return Err(format!("limit must not exceed {MAX_LIMIT}"));
        }
        Ok((self.offset, limit))
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveNodeResponse {
    pub path: Vec<PathSegment>,
    pub kind: NodeKind,
    pub display_name: String,
    pub child_count: usize,
    pub children: Vec<NodeSummary>,
    pub offset: usize,
    pub limit: usize,
    pub total_children: usize,
    pub has_more: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub preview: Option<ScalarPreview>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub byte_length: Option<usize>,
    pub editable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scalar_type: Option<ScalarType>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value: Option<EditableScalarValue>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeSummary {
    pub path: Vec<PathSegment>,
    pub display_name: String,
    pub kind: NodeKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub child_count: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub preview: Option<ScalarPreview>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub byte_length: Option<usize>,
    pub editable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scalar_type: Option<ScalarType>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value: Option<EditableScalarValue>,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum NodeKind {
    Object,
    Array,
    Scalar,
    Raw,
}

#[derive(Debug, Serialize)]
#[serde(untagged)]
pub enum ScalarPreview {
    Bool(bool),
    Number(f64),
    String(String),
}

enum Node<'a> {
    Properties(&'a Properties),
    Property(&'a Property),
    ValueElement(&'a ValueVec, usize),
    Struct(&'a StructValue),
    MapEntry(&'a uesave::MapEntry, usize),
}

pub fn inspect_path(
    save: &Save,
    path: &[PathSegment],
    offset: usize,
    limit: usize
) -> Result<SaveNodeResponse, String> {
    let mut node = Node::Properties(&save.root.properties);
    for segment in path {
        node = resolve_segment(node, segment)?;
    }
    Ok(
        response_for(
            node,
            path.to_vec(),
            path
                .last()
                .map(segment_label)
                .unwrap_or_else(|| "Root properties".to_string()),
            offset,
            limit
        )
    )
}

fn resolve_segment<'a>(node: Node<'a>, segment: &PathSegment) -> Result<Node<'a>, String> {
    match (node, segment) {
        | (Node::Properties(properties), PathSegment::Property { name, index })
        | (Node::Properties(properties), PathSegment::StructField { name, index }) =>
            properties.0
                .get(&PropertyKey(*index, name.clone()))
                .map(Node::Property)
                .ok_or_else(|| format!("property {name}_{index} was not found")),
        (Node::Property(Property::Struct(value)), segment) => {
            resolve_segment(Node::Struct(value), segment)
        }
        (Node::Struct(StructValue::Struct(properties)), PathSegment::StructField { name, index }) =>
            properties.0
                .get(&PropertyKey(*index, name.clone()))
                .map(Node::Property)
                .ok_or_else(|| format!("struct field {name}_{index} was not found")),
        (Node::Property(Property::Array(values)), PathSegment::ArrayIndex { index }) => {
            checked_value_element(values, *index)
        }
        (Node::Property(Property::Set(values)), PathSegment::SetIndex { index }) => {
            checked_value_element(values, *index)
        }
        (Node::Property(Property::Map(entries)), PathSegment::MapEntry { index }) =>
            entries
                .get(*index)
                .map(|entry| Node::MapEntry(entry, *index))
                .ok_or_else(|| format!("map entry index {index} is out of bounds")),
        (Node::Property(Property::Map(entries)), PathSegment::MapKey { index }) =>
            entries
                .get(*index)
                .map(|entry| Node::Property(&entry.key))
                .ok_or_else(|| format!("map key index {index} is out of bounds")),
        (Node::Property(Property::Map(entries)), PathSegment::MapValue { index }) =>
            entries
                .get(*index)
                .map(|entry| Node::Property(&entry.value))
                .ok_or_else(|| format!("map value index {index} is out of bounds")),
        (Node::MapEntry(entry, entry_index), PathSegment::MapKey { index }) if
            entry_index == *index
        => {
            Ok(Node::Property(&entry.key))
        }
        (Node::MapEntry(entry, entry_index), PathSegment::MapValue { index }) if
            entry_index == *index
        => {
            Ok(Node::Property(&entry.value))
        }
        (Node::ValueElement(ValueVec::Struct(values), index), segment) =>
            values
                .get(index)
                .ok_or_else(|| format!("collection index {index} is out of bounds"))
                .and_then(|value| resolve_segment(Node::Struct(value), segment)),
        _ => Err(format!("path segment {} is not supported for this node", segment_label(segment))),
    }
}

fn checked_value_element(values: &ValueVec, index: usize) -> Result<Node<'_>, String> {
    (index < value_vec_len(values))
        .then_some(Node::ValueElement(values, index))
        .ok_or_else(|| format!("collection index {index} is out of bounds"))
}

fn response_for(
    node: Node<'_>,
    path: Vec<PathSegment>,
    display_name: String,
    offset: usize,
    limit: usize
) -> SaveNodeResponse {
    let info = node_info(&node);
    let total_children = info.child_count.unwrap_or(0);
    let start = offset.min(total_children);
    let end = start.saturating_add(limit).min(total_children);
    let children = summarize_children(&node, &path, start, end);
    SaveNodeResponse {
        path,
        kind: info.kind,
        display_name,
        child_count: total_children,
        children,
        offset: start,
        limit,
        total_children,
        has_more: end < total_children,
        preview: info.preview,
        byte_length: info.byte_length,
        editable: info.editable,
        scalar_type: info.scalar_type,
        value: info.value,
    }
}

struct NodeInfo {
    kind: NodeKind,
    child_count: Option<usize>,
    preview: Option<ScalarPreview>,
    byte_length: Option<usize>,
    editable: bool,
    scalar_type: Option<ScalarType>,
    value: Option<EditableScalarValue>,
}
fn info(kind: NodeKind, child_count: Option<usize>) -> NodeInfo {
    NodeInfo {
        kind,
        child_count,
        preview: None,
        byte_length: None,
        editable: false,
        scalar_type: None,
        value: None,
    }
}
fn scalar(preview: Option<ScalarPreview>) -> NodeInfo {
    NodeInfo {
        kind: NodeKind::Scalar,
        child_count: None,
        preview,
        byte_length: None,
        editable: false,
        scalar_type: None,
        value: None,
    }
}
fn raw(byte_length: usize) -> NodeInfo {
    NodeInfo {
        kind: NodeKind::Raw,
        child_count: None,
        preview: None,
        byte_length: Some(byte_length),
        editable: false,
        scalar_type: None,
        value: None,
    }
}
fn number(value: f64) -> NodeInfo {
    scalar(value.is_finite().then_some(ScalarPreview::Number(value)))
}
fn editable(value: EditableScalarValue, preview: Option<ScalarPreview>) -> NodeInfo {
    let scalar_type = match &value {
        EditableScalarValue::Bool(_) => ScalarType::Bool,
        EditableScalarValue::Int8(_) => ScalarType::Int8,
        EditableScalarValue::Int16(_) => ScalarType::Int16,
        EditableScalarValue::Int32(_) => ScalarType::Int32,
        EditableScalarValue::Int64(_) => ScalarType::Int64,
        EditableScalarValue::UInt8(_) => ScalarType::UInt8,
        EditableScalarValue::UInt16(_) => ScalarType::UInt16,
        EditableScalarValue::UInt32(_) => ScalarType::UInt32,
        EditableScalarValue::UInt64(_) => ScalarType::UInt64,
        EditableScalarValue::Float(_) => ScalarType::Float,
        EditableScalarValue::Double(_) => ScalarType::Double,
        EditableScalarValue::String(_) => ScalarType::String,
        EditableScalarValue::Name(_) => ScalarType::Name,
        EditableScalarValue::Enum(_) => ScalarType::Enum,
    };
    NodeInfo {
        kind: NodeKind::Scalar,
        child_count: None,
        preview,
        byte_length: None,
        editable: true,
        scalar_type: Some(scalar_type),
        value: Some(value),
    }
}

fn node_info(node: &Node<'_>) -> NodeInfo {
    match node {
        Node::Properties(v) => info(NodeKind::Object, Some(v.0.len())),
        Node::MapEntry(_, _) => info(NodeKind::Object, Some(2)),
        Node::Struct(StructValue::Struct(v)) => info(NodeKind::Object, Some(v.0.len())),
        Node::Struct(StructValue::Raw(v)) => raw(v.len()),
        Node::Struct(_) => scalar(None),
        Node::Property(v) => property_info(v),
        Node::ValueElement(v, i) => value_element_info(v, *i),
    }
}

fn property_info(property: &Property) -> NodeInfo {
    match property {
        Property::Struct(v) => node_info(&Node::Struct(v)),
        Property::Array(v) | Property::Set(v) => info(NodeKind::Array, Some(value_vec_len(v))),
        Property::Map(v) => info(NodeKind::Object, Some(v.len())),
        Property::Raw(v) => raw(v.len()),
        Property::Int8(v) =>
            editable(EditableScalarValue::Int8(*v), Some(ScalarPreview::Number(*v as f64))),
        Property::Int16(v) =>
            editable(EditableScalarValue::Int16(*v), Some(ScalarPreview::Number(*v as f64))),
        Property::Int(v) =>
            editable(EditableScalarValue::Int32(*v), Some(ScalarPreview::Number(*v as f64))),
        Property::Int64(v) =>
            editable(
                EditableScalarValue::Int64(v.to_string()),
                Some(ScalarPreview::String(v.to_string()))
            ),
        Property::UInt8(v) =>
            editable(EditableScalarValue::UInt8(*v), Some(ScalarPreview::Number(*v as f64))),
        Property::UInt16(v) =>
            editable(EditableScalarValue::UInt16(*v), Some(ScalarPreview::Number(*v as f64))),
        Property::UInt32(v) =>
            editable(EditableScalarValue::UInt32(*v), Some(ScalarPreview::Number(*v as f64))),
        Property::UInt64(v) =>
            editable(
                EditableScalarValue::UInt64(v.to_string()),
                Some(ScalarPreview::String(v.to_string()))
            ),
        Property::Float(v) if v.0.is_finite() =>
            editable(EditableScalarValue::Float(v.0), Some(ScalarPreview::Number(v.0 as f64))),
        Property::Double(v) if v.0.is_finite() =>
            editable(EditableScalarValue::Double(v.0), Some(ScalarPreview::Number(v.0))),
        Property::Float(v) => number(v.0 as f64),
        Property::Double(v) => number(v.0),
        Property::Bool(v) => editable(EditableScalarValue::Bool(*v), Some(ScalarPreview::Bool(*v))),
        Property::Str(v) =>
            editable(
                EditableScalarValue::String(v.clone()),
                Some(ScalarPreview::String(truncate(v)))
            ),
        Property::Name(v) =>
            editable(
                EditableScalarValue::Name(v.clone()),
                Some(ScalarPreview::String(truncate(v)))
            ),
        Property::Enum(v) =>
            editable(
                EditableScalarValue::Enum(v.clone()),
                Some(ScalarPreview::String(truncate(v)))
            ),
        _ => scalar(None),
    }
}

fn summarize_children(
    node: &Node<'_>,
    parent: &[PathSegment],
    start: usize,
    end: usize
) -> Vec<NodeSummary> {
    match node {
        Node::Properties(properties) =>
            properties.0
                .iter()
                .skip(start)
                .take(end - start)
                .map(|(key, property)| {
                    let segment = if parent.is_empty() {
                        PathSegment::Property {
                            name: key.1.clone(),
                            index: key.0,
                        }
                    } else {
                        PathSegment::StructField {
                            name: key.1.clone(),
                            index: key.0,
                        }
                    };
                    summary(
                        Node::Property(property),
                        appended(parent, segment),
                        property_label(key)
                    )
                })
                .collect(),
        Node::Struct(StructValue::Struct(properties)) => {
            summarize_children(&Node::Properties(properties), parent, start, end)
        }
        Node::Property(Property::Struct(value)) => {
            summarize_children(&Node::Struct(value), parent, start, end)
        }
        Node::ValueElement(ValueVec::Struct(values), index) =>
            values
                .get(*index)
                .map(|value| summarize_children(&Node::Struct(value), parent, start, end))
                .unwrap_or_default(),
        Node::Property(Property::Array(values)) => {
            summarize_value_vec(values, parent, start, end, false)
        }
        Node::Property(Property::Set(values)) => {
            summarize_value_vec(values, parent, start, end, true)
        }
        Node::Property(Property::Map(entries)) =>
            entries
                .iter()
                .enumerate()
                .skip(start)
                .take(end - start)
                .map(|(index, entry)| {
                    summary(
                        Node::MapEntry(entry, index),
                        appended(parent, PathSegment::MapEntry { index }),
                        format!("Entry {index}")
                    )
                })
                .collect(),
        Node::MapEntry(entry, index) =>
            [
                ("Key", &entry.key),
                ("Value", &entry.value),
            ]
                .into_iter()
                .enumerate()
                .skip(start)
                .take(end - start)
                .map(|(part, (label, property))| {
                    let segment = if part == 0 {
                        PathSegment::MapKey { index: *index }
                    } else {
                        PathSegment::MapValue { index: *index }
                    };
                    summary(Node::Property(property), appended(parent, segment), label.to_string())
                })
                .collect(),
        _ => Vec::new(),
    }
}

fn summarize_value_vec(
    values: &ValueVec,
    parent: &[PathSegment],
    start: usize,
    end: usize,
    is_set: bool
) -> Vec<NodeSummary> {
    (start..end)
        .map(|index| {
            let segment = if is_set {
                PathSegment::SetIndex { index }
            } else {
                PathSegment::ArrayIndex { index }
            };
            summary(
                Node::ValueElement(values, index),
                appended(parent, segment),
                format!("[{index}]")
            )
        })
        .collect()
}

fn summary(node: Node<'_>, path: Vec<PathSegment>, display_name: String) -> NodeSummary {
    let info = node_info(&node);
    NodeSummary {
        path,
        display_name,
        kind: info.kind,
        child_count: info.child_count,
        preview: info.preview,
        byte_length: info.byte_length,
        editable: info.editable,
        scalar_type: info.scalar_type,
        value: info.value,
    }
}

fn value_element_info(values: &ValueVec, index: usize) -> NodeInfo {
    macro_rules! scalar_at {
        ($v:expr, $variant:ident) => {
            $v.get(index)
                .map(|x| {
                    editable(
                        EditableScalarValue::$variant(*x),
                        Some(ScalarPreview::Number(*x as f64)),
                    )
                })
                .unwrap_or_else(|| scalar(None))
        };
    }
    match values {
        ValueVec::Int8(v) => scalar_at!(v, Int8),
        ValueVec::Int16(v) => scalar_at!(v, Int16),
        ValueVec::Int(v) => scalar_at!(v, Int32),
        ValueVec::UInt8(v) => scalar_at!(v, UInt8),
        ValueVec::UInt16(v) => scalar_at!(v, UInt16),
        ValueVec::UInt32(v) => scalar_at!(v, UInt32),
        ValueVec::Int64(v) =>
            v
                .get(index)
                .map(|x| {
                    editable(
                        EditableScalarValue::Int64(x.to_string()),
                        Some(ScalarPreview::String(x.to_string()))
                    )
                })
                .unwrap_or_else(|| scalar(None)),
        ValueVec::UInt64(v) =>
            v
                .get(index)
                .map(|x| {
                    editable(
                        EditableScalarValue::UInt64(x.to_string()),
                        Some(ScalarPreview::String(x.to_string()))
                    )
                })
                .unwrap_or_else(|| scalar(None)),
        ValueVec::Float(v) =>
            v
                .get(index)
                .map(|x| {
                    if x.0.is_finite() {
                        editable(
                            EditableScalarValue::Float(x.0),
                            Some(ScalarPreview::Number(x.0 as f64))
                        )
                    } else {
                        scalar(None)
                    }
                })
                .unwrap_or_else(|| scalar(None)),
        ValueVec::Double(v) =>
            v
                .get(index)
                .map(|x| {
                    if x.0.is_finite() {
                        editable(EditableScalarValue::Double(x.0), Some(ScalarPreview::Number(x.0)))
                    } else {
                        scalar(None)
                    }
                })
                .unwrap_or_else(|| scalar(None)),
        ValueVec::Bool(v) =>
            v
                .get(index)
                .map(|x| editable(EditableScalarValue::Bool(*x), Some(ScalarPreview::Bool(*x))))
                .unwrap_or_else(|| scalar(None)),
        ValueVec::Enum(v) =>
            v
                .get(index)
                .map(|x| {
                    editable(
                        EditableScalarValue::Enum(x.clone()),
                        Some(ScalarPreview::String(truncate(x)))
                    )
                })
                .unwrap_or_else(|| scalar(None)),
        ValueVec::Str(v) =>
            v
                .get(index)
                .map(|x| {
                    editable(
                        EditableScalarValue::String(x.clone()),
                        Some(ScalarPreview::String(truncate(x)))
                    )
                })
                .unwrap_or_else(|| scalar(None)),
        ValueVec::Name(v) =>
            v
                .get(index)
                .map(|x| {
                    editable(
                        EditableScalarValue::Name(x.clone()),
                        Some(ScalarPreview::String(truncate(x)))
                    )
                })
                .unwrap_or_else(|| scalar(None)),
        ValueVec::Byte(uesave::ByteArray::Byte(v)) =>
            v
                .get(index)
                .map(|x| number(*x as f64))
                .unwrap_or_else(|| scalar(None)),
        ValueVec::Byte(uesave::ByteArray::Label(v)) =>
            v
                .get(index)
                .map(|x| scalar(Some(ScalarPreview::String(truncate(x)))))
                .unwrap_or_else(|| scalar(None)),
        ValueVec::Struct(v) =>
            v
                .get(index)
                .map(|x| node_info(&Node::Struct(x)))
                .unwrap_or_else(|| scalar(None)),
        _ => scalar(None),
    }
}

fn value_vec_len(value: &ValueVec) -> usize {
    match value {
        ValueVec::Int8(v) => v.len(),
        ValueVec::Int16(v) => v.len(),
        ValueVec::Int(v) => v.len(),
        ValueVec::Int64(v) => v.len(),
        ValueVec::UInt8(v) => v.len(),
        ValueVec::UInt16(v) => v.len(),
        ValueVec::UInt32(v) => v.len(),
        ValueVec::UInt64(v) => v.len(),
        ValueVec::Float(v) => v.len(),
        ValueVec::Double(v) => v.len(),
        ValueVec::Bool(v) => v.len(),
        ValueVec::Byte(uesave::ByteArray::Byte(v)) => v.len(),
        ValueVec::Byte(uesave::ByteArray::Label(v)) => v.len(),
        ValueVec::Enum(v) => v.len(),
        ValueVec::Str(v) => v.len(),
        ValueVec::Text(v) => v.len(),
        ValueVec::SoftObject(v) => v.len(),
        ValueVec::Name(v) => v.len(),
        ValueVec::Object(v) => v.len(),
        ValueVec::Box(v) => v.len(),
        ValueVec::Box2D(v) => v.len(),
        ValueVec::Struct(v) => v.len(),
    }
}

fn property_label(key: &PropertyKey) -> String {
    if key.0 == 0 { key.1.clone() } else { format!("{} [{}]", key.1, key.0) }
}
fn segment_label(segment: &PathSegment) -> String {
    match segment {
        PathSegment::Property { name, index } | PathSegment::StructField { name, index } => {
            property_label(&PropertyKey(*index, name.clone()))
        }
        PathSegment::ArrayIndex { index } | PathSegment::SetIndex { index } => format!("[{index}]"),
        PathSegment::MapEntry { index } => format!("Entry {index}"),
        PathSegment::MapKey { .. } => "Key".to_string(),
        PathSegment::MapValue { .. } => "Value".to_string(),
    }
}
fn appended(path: &[PathSegment], segment: PathSegment) -> Vec<PathSegment> {
    let mut result = path.to_vec();
    result.push(segment);
    result
}
fn truncate(value: &str) -> String {
    let mut chars = value.chars();
    let prefix: String = chars.by_ref().take(PREVIEW_CHARS).collect();
    if chars.next().is_some() {
        format!("{prefix}…")
    } else {
        prefix
    }
}

pub enum ScalarTargetMut<'a> {
    Property(&'a mut Property),
    ValueElement(&'a mut ValueVec, usize),
}

pub fn resolve_scalar_mut<'a>(
    save: &'a mut Save,
    path: &[PathSegment]
) -> Result<ScalarTargetMut<'a>, String> {
    let (first, rest) = path
        .split_first()
        .ok_or_else(|| "the root node is not editable".to_string())?;
    let property = match first {
        PathSegment::Property { name, index } =>
            save.root.properties.0
                .get_mut(&PropertyKey(*index, name.clone()))
                .ok_or_else(|| format!("property {name}_{index} was not found"))?,
        _ => {
            return Err("a scalar path must begin with a property segment".to_string());
        }
    };
    resolve_property_target(property, rest)
}

fn resolve_property_target<'a>(
    property: &'a mut Property,
    path: &[PathSegment]
) -> Result<ScalarTargetMut<'a>, String> {
    let Some((segment, rest)) = path.split_first() else {
        return Ok(ScalarTargetMut::Property(property));
    };
    match (property, segment) {
        (
            Property::Struct(StructValue::Struct(properties)),
            PathSegment::StructField { name, index },
        ) => {
            let child = properties.0
                .get_mut(&PropertyKey(*index, name.clone()))
                .ok_or_else(|| format!("struct field {name}_{index} was not found"))?;
            resolve_property_target(child, rest)
        }
        | (Property::Array(values), PathSegment::ArrayIndex { index })
        | (Property::Set(values), PathSegment::SetIndex { index }) => {
            resolve_value_target(values, *index, rest)
        }
        (Property::Map(entries), PathSegment::MapKey { index }) => {
            let entry = entries
                .get_mut(*index)
                .ok_or_else(|| format!("map key index {index} is out of bounds"))?;
            resolve_property_target(&mut entry.key, rest)
        }
        (Property::Map(entries), PathSegment::MapValue { index }) => {
            let entry = entries
                .get_mut(*index)
                .ok_or_else(|| format!("map value index {index} is out of bounds"))?;
            resolve_property_target(&mut entry.value, rest)
        }
        (Property::Map(entries), PathSegment::MapEntry { index }) => {
            let entry = entries
                .get_mut(*index)
                .ok_or_else(|| format!("map entry index {index} is out of bounds"))?;
            let (part, tail) = rest
                .split_first()
                .ok_or_else(|| "a map entry is not an editable scalar".to_string())?;
            match part {
                PathSegment::MapKey { index: part_index } if part_index == index => {
                    resolve_property_target(&mut entry.key, tail)
                }
                PathSegment::MapValue { index: part_index } if part_index == index => {
                    resolve_property_target(&mut entry.value, tail)
                }
                _ => Err("map entry path does not identify its key or value".to_string()),
            }
        }
        (_, segment) =>
            Err(
                format!(
                    "path segment {} is not supported for scalar mutation",
                    segment_label(segment)
                )
            ),
    }
}

fn resolve_value_target<'a>(
    values: &'a mut ValueVec,
    index: usize,
    path: &[PathSegment]
) -> Result<ScalarTargetMut<'a>, String> {
    if index >= value_vec_len(values) {
        return Err(format!("collection index {index} is out of bounds"));
    }
    if path.is_empty() {
        return Ok(ScalarTargetMut::ValueElement(values, index));
    }
    let ValueVec::Struct(structs) = values else {
        return Err("a primitive collection element cannot have child path segments".to_string());
    };
    let value = structs
        .get_mut(index)
        .ok_or_else(|| format!("collection index {index} is out of bounds"))?;
    let StructValue::Struct(properties) = value else {
        return Err("this struct collection element has no editable fields".to_string());
    };
    let (segment, rest) = path.split_first().ok_or_else(|| "missing struct field".to_string())?;
    let PathSegment::StructField { name, index } = segment else {
        return Err("expected a struct field path segment".to_string());
    };
    let child = properties.0
        .get_mut(&PropertyKey(*index, name.clone()))
        .ok_or_else(|| format!("struct field {name}_{index} was not found"))?;
    resolve_property_target(child, rest)
}

pub fn update_scalar(
    save: &mut Save,
    path: &[PathSegment],
    value: EditableScalarValue
) -> Result<EditableScalarValue, String> {
    let target = resolve_scalar_mut(save, path)?;
    apply_scalar(target, value)
}

fn finite_f32(value: f32) -> Result<f32, String> {
    value
        .is_finite()
        .then_some(value)
        .ok_or_else(|| "float value must be finite".to_string())
}
fn finite_f64(value: f64) -> Result<f64, String> {
    value
        .is_finite()
        .then_some(value)
        .ok_or_else(|| "double value must be finite".to_string())
}
fn parse_i64(value: &str) -> Result<i64, String> {
    value.parse::<i64>().map_err(|_| "int64 value must be a base-10 integer in range".to_string())
}
fn parse_u64(value: &str) -> Result<u64, String> {
    value.parse::<u64>().map_err(|_| "uint64 value must be a base-10 integer in range".to_string())
}

fn apply_scalar(
    target: ScalarTargetMut<'_>,
    value: EditableScalarValue
) -> Result<EditableScalarValue, String> {
    match target {
        ScalarTargetMut::Property(property) => apply_property_scalar(property, value),
        ScalarTargetMut::ValueElement(values, index) => apply_value_scalar(values, index, value),
    }
}

fn apply_property_scalar(
    property: &mut Property,
    value: EditableScalarValue
) -> Result<EditableScalarValue, String> {
    macro_rules! assign {
        ($variant:ident, $incoming:ident) => {
            if let EditableScalarValue::$variant(v) = value {
                *$incoming = v;
                return Ok(EditableScalarValue::$variant(*$incoming));
            }
        };
    }
    match property {
        Property::Bool(v) => assign!(Bool, v),
        Property::Int8(v) => assign!(Int8, v),
        Property::Int16(v) => assign!(Int16, v),
        Property::Int(v) => assign!(Int32, v),
        Property::UInt8(v) => assign!(UInt8, v),
        Property::UInt16(v) => assign!(UInt16, v),
        Property::UInt32(v) => assign!(UInt32, v),
        Property::Int64(stored) => {
            if let EditableScalarValue::Int64(v) = value {
                *stored = parse_i64(&v)?;
                return Ok(EditableScalarValue::Int64(stored.to_string()));
            }
        }
        Property::UInt64(stored) => {
            if let EditableScalarValue::UInt64(v) = value {
                *stored = parse_u64(&v)?;
                return Ok(EditableScalarValue::UInt64(stored.to_string()));
            }
        }
        Property::Float(stored) => {
            if let EditableScalarValue::Float(v) = value {
                stored.0 = finite_f32(v)?;
                return Ok(EditableScalarValue::Float(stored.0));
            }
        }
        Property::Double(stored) => {
            if let EditableScalarValue::Double(v) = value {
                stored.0 = finite_f64(v)?;
                return Ok(EditableScalarValue::Double(stored.0));
            }
        }
        Property::Str(stored) => {
            if let EditableScalarValue::String(v) = value {
                *stored = v;
                return Ok(EditableScalarValue::String(stored.clone()));
            }
        }
        Property::Name(stored) => {
            if let EditableScalarValue::Name(v) = value {
                *stored = v;
                return Ok(EditableScalarValue::Name(stored.clone()));
            }
        }
        Property::Enum(stored) => {
            if let EditableScalarValue::Enum(v) = value {
                *stored = v;
                return Ok(EditableScalarValue::Enum(stored.clone()));
            }
        }
        _ => {
            return Err("this property type is not editable".to_string());
        }
    }
    Err("supplied scalar type does not match the property type".to_string())
}

fn apply_value_scalar(
    values: &mut ValueVec,
    index: usize,
    value: EditableScalarValue
) -> Result<EditableScalarValue, String> {
    macro_rules! assign_vec {
        ($vec:expr, $variant:ident) => {
            if let EditableScalarValue::$variant(v) = value {
                let stored = $vec
                    .get_mut(index)
                    .ok_or_else(|| format!("collection index {index} is out of bounds"))?;
                *stored = v;
                return Ok(EditableScalarValue::$variant(*stored));
            }
        };
    }
    match values {
        ValueVec::Bool(v) => assign_vec!(v, Bool),
        ValueVec::Int8(v) => assign_vec!(v, Int8),
        ValueVec::Int16(v) => assign_vec!(v, Int16),
        ValueVec::Int(v) => assign_vec!(v, Int32),
        ValueVec::UInt8(v) => assign_vec!(v, UInt8),
        ValueVec::UInt16(v) => assign_vec!(v, UInt16),
        ValueVec::UInt32(v) => assign_vec!(v, UInt32),
        ValueVec::Int64(v) => {
            if let EditableScalarValue::Int64(raw) = value {
                let parsed = parse_i64(&raw)?;
                *v
                    .get_mut(index)
                    .ok_or_else(|| format!("collection index {index} is out of bounds"))? = parsed;
                return Ok(EditableScalarValue::Int64(parsed.to_string()));
            }
        }
        ValueVec::UInt64(v) => {
            if let EditableScalarValue::UInt64(raw) = value {
                let parsed = parse_u64(&raw)?;
                *v
                    .get_mut(index)
                    .ok_or_else(|| format!("collection index {index} is out of bounds"))? = parsed;
                return Ok(EditableScalarValue::UInt64(parsed.to_string()));
            }
        }
        ValueVec::Float(v) => {
            if let EditableScalarValue::Float(raw) = value {
                let parsed = finite_f32(raw)?;
                v
                    .get_mut(index)
                    .ok_or_else(|| format!("collection index {index} is out of bounds"))?.0 =
                    parsed;
                return Ok(EditableScalarValue::Float(parsed));
            }
        }
        ValueVec::Double(v) => {
            if let EditableScalarValue::Double(raw) = value {
                let parsed = finite_f64(raw)?;
                v
                    .get_mut(index)
                    .ok_or_else(|| format!("collection index {index} is out of bounds"))?.0 =
                    parsed;
                return Ok(EditableScalarValue::Double(parsed));
            }
        }
        ValueVec::Str(v) => {
            if let EditableScalarValue::String(raw) = value {
                *v
                    .get_mut(index)
                    .ok_or_else(|| format!("collection index {index} is out of bounds"))? =
                    raw.clone();
                return Ok(EditableScalarValue::String(raw));
            }
        }
        ValueVec::Name(v) => {
            if let EditableScalarValue::Name(raw) = value {
                *v
                    .get_mut(index)
                    .ok_or_else(|| format!("collection index {index} is out of bounds"))? =
                    raw.clone();
                return Ok(EditableScalarValue::Name(raw));
            }
        }
        ValueVec::Enum(v) => {
            if let EditableScalarValue::Enum(raw) = value {
                *v
                    .get_mut(index)
                    .ok_or_else(|| format!("collection index {index} is out of bounds"))? =
                    raw.clone();
                return Ok(EditableScalarValue::Enum(raw));
            }
        }
        _ => {
            return Err("this collection element type is not editable".to_string());
        }
    }
    Err("supplied scalar type does not match the collection element type".to_string())
}
