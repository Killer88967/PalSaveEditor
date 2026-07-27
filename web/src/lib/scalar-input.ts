import type { EditableScalarValue } from "@/lib/palsave-api";

const SIGNED_DECIMAL = /^-?\d+$/;
const UNSIGNED_DECIMAL = /^\d+$/;

const INTEGER_RANGES = {
  int8: [BigInt(-128), BigInt(127)],
  int16: [BigInt(-32768), BigInt(32767)],
  int32: [BigInt(-2147483648), BigInt(2147483647)],
  uint8: [BigInt(0), BigInt(255)],
  uint16: [BigInt(0), BigInt(65535)],
  uint32: [BigInt(0), BigInt(4294967295)],
} as const;

const INT64_MIN = BigInt("-9223372036854775808");
const INT64_MAX = BigInt("9223372036854775807");
const UINT64_MAX = BigInt("18446744073709551615");
const F32_MAX = 3.4028234663852886e38;

function parseDecimal(
  input: string,
  unsigned: boolean,
  minimum: bigint,
  maximum: bigint,
): bigint {
  if (input.length === 0 || input !== input.trim()) {
    throw new Error("Enter an integer without surrounding whitespace.");
  }
  const syntax = unsigned ? UNSIGNED_DECIMAL : SIGNED_DECIMAL;
  if (!syntax.test(input)) {
    throw new Error(
      unsigned
        ? "Enter an unsigned base-10 integer."
        : "Enter a base-10 integer.",
    );
  }
  const parsed = BigInt(input);
  if (parsed < minimum || parsed > maximum) {
    throw new Error(`Value must be between ${minimum} and ${maximum}.`);
  }
  return parsed;
}

export function isTextScalar(value: EditableScalarValue): boolean {
  return ["string", "name", "enum", "int64", "uint64"].includes(value.type);
}

export function scalarFromInput(
  value: EditableScalarValue,
  input: string,
  checked: boolean,
): EditableScalarValue {
  switch (value.type) {
    case "bool":
      return { type: "bool", value: checked };
    case "string":
    case "name":
    case "enum":
      return { type: value.type, value: input };
    case "int64":
      parseDecimal(input, false, INT64_MIN, INT64_MAX);
      return { type: "int64", value: input };
    case "uint64":
      parseDecimal(input, true, BigInt(0), UINT64_MAX);
      return { type: "uint64", value: input };
    case "int8":
    case "int16":
    case "int32":
    case "uint8":
    case "uint16":
    case "uint32": {
      const [minimum, maximum] = INTEGER_RANGES[value.type];
      const parsed = parseDecimal(
        input,
        value.type.startsWith("uint"),
        minimum,
        maximum,
      );
      return { type: value.type, value: Number(parsed) };
    }
    case "float":
    case "double": {
      if (input.length === 0 || input.trim().length === 0) {
        throw new Error("Enter a finite number.");
      }
      const parsed = Number(input);
      if (!Number.isFinite(parsed)) {
        throw new Error("Enter a finite number.");
      }
      if (value.type === "float" && Math.abs(parsed) > F32_MAX) {
        throw new Error("Value is outside the finite float range.");
      }
      return { type: value.type, value: parsed };
    }
  }
}
