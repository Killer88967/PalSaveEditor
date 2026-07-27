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
    }
}

struct NodeInfo {
    kind: NodeKind,
    child_count: Option<usize>,
    preview: Option<ScalarPreview>,
    byte_length: Option<usize>,
}
fn info(kind: NodeKind, child_count: Option<usize>) -> NodeInfo {
    NodeInfo {
        kind,
        child_count,
        preview: None,
        byte_length: None,
    }
}
fn scalar(preview: Option<ScalarPreview>) -> NodeInfo {
    NodeInfo {
        kind: NodeKind::Scalar,
        child_count: None,
        preview,
        byte_length: None,
    }
}
fn raw(byte_length: usize) -> NodeInfo {
    NodeInfo {
        kind: NodeKind::Raw,
        child_count: None,
        preview: None,
        byte_length: Some(byte_length),
    }
}
fn number(value: f64) -> NodeInfo {
    scalar(value.is_finite().then_some(ScalarPreview::Number(value)))
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
        Property::Int8(v) => number(*v as f64),
        Property::Int16(v) => number(*v as f64),
        Property::Int(v) => number(*v as f64),
        Property::Int64(v) => number(*v as f64),
        Property::UInt8(v) => number(*v as f64),
        Property::UInt16(v) => number(*v as f64),
        Property::UInt32(v) => number(*v as f64),
        Property::UInt64(v) => number(*v as f64),
        Property::Float(v) => number(v.0 as f64),
        Property::Double(v) => number(v.0),
        Property::Bool(v) => scalar(Some(ScalarPreview::Bool(*v))),
        Property::Str(v) | Property::Name(v) | Property::Enum(v) => {
            scalar(Some(ScalarPreview::String(truncate(v))))
        }
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
    }
}

fn value_element_info(values: &ValueVec, index: usize) -> NodeInfo {
    macro_rules! nums {
        ($v:expr) => {
            $v.get(index)
                .map(|x| number(*x as f64))
                .unwrap_or_else(|| scalar(None))
        };
    }
    match values {
        ValueVec::Int8(v) => nums!(v),
        ValueVec::Int16(v) => nums!(v),
        ValueVec::Int(v) => nums!(v),
        ValueVec::Int64(v) => nums!(v),
        ValueVec::UInt8(v) => nums!(v),
        ValueVec::UInt16(v) => nums!(v),
        ValueVec::UInt32(v) => nums!(v),
        ValueVec::UInt64(v) => nums!(v),
        ValueVec::Float(v) =>
            v
                .get(index)
                .map(|x| number(x.0 as f64))
                .unwrap_or_else(|| scalar(None)),
        ValueVec::Double(v) =>
            v
                .get(index)
                .map(|x| number(x.0))
                .unwrap_or_else(|| scalar(None)),
        ValueVec::Bool(v) =>
            v
                .get(index)
                .map(|x| scalar(Some(ScalarPreview::Bool(*x))))
                .unwrap_or_else(|| scalar(None)),
        ValueVec::Enum(v) | ValueVec::Str(v) | ValueVec::Name(v) =>
            v
                .get(index)
                .map(|x| scalar(Some(ScalarPreview::String(truncate(x)))))
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
