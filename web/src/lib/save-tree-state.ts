import type {
  EditableScalarValue,
  SaveNodeSummary,
  SavePathSegment,
  ScalarType,
} from "@/lib/palsave-api";

export function pathKey(path: SavePathSegment[]): string {
  return JSON.stringify(path);
}

function scalarType(value: EditableScalarValue): ScalarType {
  return value.type;
}

export function updateSummaryAtPath(
  node: SaveNodeSummary,
  path: SavePathSegment[],
  value: EditableScalarValue,
): SaveNodeSummary {
  if (pathKey(node.path) !== pathKey(path)) return node;
  return {
    ...node,
    editable: true,
    scalarType: scalarType(value),
    value,
    preview: value.value,
  };
}
