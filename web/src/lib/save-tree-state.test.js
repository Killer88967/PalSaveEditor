import { expect, test } from "bun:test";
import { updateSummaryAtPath } from "./save-tree-state";

const path = [{ type: "property", name: "Value", index: 0 }];
const node = {
  path,
  displayName: "Value",
  kind: "scalar",
  editable: false,
  scalarType: "int32",
  value: { type: "int32", value: 1 },
  preview: 1,
};

test("updates only exact typed paths and restores scalar metadata", () => {
  const updated = updateSummaryAtPath(node, path, {
    type: "uint64",
    value: "18446744073709551615",
  });
  expect(updated).toEqual({
    ...node,
    editable: true,
    scalarType: "uint64",
    value: { type: "uint64", value: "18446744073709551615" },
    preview: "18446744073709551615",
  });
  expect(
    updateSummaryAtPath(node, [{ type: "property", name: "Value", index: 1 }], {
      type: "int32",
      value: 2,
    }),
  ).toBe(node);
  expect(
    updateSummaryAtPath(
      node,
      [{ type: "structField", name: "Value", index: 0 }],
      { type: "int32", value: 2 },
    ),
  ).toBe(node);
});
