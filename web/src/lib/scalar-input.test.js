import { describe, expect, test } from "bun:test";
import { scalarFromInput } from "./scalar-input";

const current = (type, value = 0) => ({ type, value });
const rejects = (type, inputs) => {
  for (const input of inputs) {
    expect(() => scalarFromInput(current(type), input, false)).toThrow();
  }
};

describe("scalarFromInput", () => {
  test("enforces fixed-width integer syntax and ranges", () => {
    expect(scalarFromInput(current("int8"), "-128", false)).toEqual({
      type: "int8",
      value: -128,
    });
    expect(scalarFromInput(current("uint32"), "4294967295", false)).toEqual({
      type: "uint32",
      value: 4294967295,
    });
    rejects("int8", ["-129", "128", "1e2", "1.0", "", " ", " 1", "+1"]);
    rejects("uint8", ["-1", "256", "1e2", "", " "]);
    rejects("uint16", ["-1", "65536"]);
    rejects("uint32", ["-1", "4294967296"]);
  });

  test("keeps exact 64-bit integers as strings", () => {
    expect(
      scalarFromInput(current("int64", "0"), "-9223372036854775808", false),
    ).toEqual({ type: "int64", value: "-9223372036854775808" });
    expect(
      scalarFromInput(current("uint64", "0"), "18446744073709551615", false),
    ).toEqual({ type: "uint64", value: "18446744073709551615" });
    rejects("int64", [
      "-9223372036854775809",
      "9223372036854775808",
      "+1",
      "1.0",
      "1e2",
      "",
      " ",
      " 1",
    ]);
    rejects("uint64", [
      "-1",
      "18446744073709551616",
      "+1",
      "1.0",
      "1e2",
      "",
      " ",
      " 1",
    ]);
  });

  test("rejects non-finite and out-of-range floats", () => {
    expect(scalarFromInput(current("float"), "1.25", false)).toEqual({
      type: "float",
      value: 1.25,
    });
    expect(scalarFromInput(current("double"), "-2.5", false)).toEqual({
      type: "double",
      value: -2.5,
    });
    rejects("float", ["", " ", "NaN", "Infinity", "-Infinity", "3.5e38"]);
    rejects("double", ["", " ", "NaN", "Infinity", "-Infinity", "1e400"]);
  });
});
