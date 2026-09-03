export type NinebotParityKind =
  | "array"
  | "boolean"
  | "null"
  | "number"
  | "object"
  | "string"
  | "undefined"
  | "function"
  | "symbol"
  | "bigint";

export type NinebotParityDifferenceReason =
  | "missing-in-oracle"
  | "missing-in-candidate"
  | "type-mismatch"
  | "length-mismatch"
  | "value-mismatch";

export interface NinebotParityDifference {
  /** JSON-like path to the differing node; no node value is included. */
  path: string;
  reason: NinebotParityDifferenceReason;
  oracleKind: NinebotParityKind | "missing";
  candidateKind: NinebotParityKind | "missing";
  oracleLength: number | null;
  candidateLength: number | null;
}

export interface NinebotParityReport {
  equal: boolean;
  differences: readonly NinebotParityDifference[];
  comparedNodes: number;
  truncated: boolean;
}

export interface NinebotParityOptions {
  /** Maximum number of array elements inspected at each level. Defaults to 256. */
  maxArrayItems?: number;
  /** Maximum nested container depth inspected. Defaults to 12. */
  maxDepth?: number;
  /** Maximum differences retained in the report. Defaults to 100. */
  maxDifferences?: number;
}

const defaultOptions = {
  maxArrayItems: 256,
  maxDepth: 12,
  maxDifferences: 100,
} as const;

const getKind = (value: unknown): NinebotParityKind => {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value as NinebotParityKind;
};

const isContainer = (kind: NinebotParityKind) => kind === "array" || kind === "object";

const getLength = (value: unknown, kind: NinebotParityKind) => {
  if (kind === "string") return (value as string).length;
  if (kind === "array") return (value as readonly unknown[]).length;
  if (kind === "object") return Object.keys(value as Record<string, unknown>).length;
  return null;
};

const appendDifference = (
  differences: NinebotParityDifference[],
  difference: NinebotParityDifference,
  maxDifferences: number,
) => {
  if (differences.length < maxDifferences) differences.push(difference);
};

/**
 * Compares two JSON-like payloads without placing their values in the report.
 *
 * Values are compared only in memory. The returned report contains paths,
 * kinds, lengths, and reasons, making it suitable for local ninecli/Node
 * parity checks without persisting credentials, identifiers, coordinates, or
 * response bodies.
 */
export const compareNinebotPayloads = (
  oracle: unknown,
  candidate: unknown,
  options: NinebotParityOptions = {},
): NinebotParityReport => {
  const maxArrayItems = options.maxArrayItems ?? defaultOptions.maxArrayItems;
  const maxDepth = options.maxDepth ?? defaultOptions.maxDepth;
  const maxDifferences = options.maxDifferences ?? defaultOptions.maxDifferences;
  if (!Number.isSafeInteger(maxArrayItems) || maxArrayItems < 0) {
    throw new Error("Ninebot parity maxArrayItems must be a non-negative safe integer");
  }
  if (!Number.isSafeInteger(maxDepth) || maxDepth < 0) {
    throw new Error("Ninebot parity maxDepth must be a non-negative safe integer");
  }
  if (!Number.isSafeInteger(maxDifferences) || maxDifferences < 1) {
    throw new Error("Ninebot parity maxDifferences must be a positive safe integer");
  }

  const differences: NinebotParityDifference[] = [];
  let comparedNodes = 0;
  let truncated = false;

  const walk = (oracleValue: unknown, candidateValue: unknown, path: string, depth: number) => {
    comparedNodes += 1;
    const oracleKind = getKind(oracleValue);
    const candidateKind = getKind(candidateValue);
    const oracleLength = getLength(oracleValue, oracleKind);
    const candidateLength = getLength(candidateValue, candidateKind);
    if (oracleKind !== candidateKind) {
      appendDifference(
        differences,
        { path, reason: "type-mismatch", oracleKind, candidateKind, oracleLength, candidateLength },
        maxDifferences,
      );
      return;
    }

    if (isContainer(oracleKind) && depth >= maxDepth) {
      truncated = true;
      return;
    }
    if (oracleKind === "array") {
      if (oracleLength !== candidateLength) {
        appendDifference(
          differences,
          {
            path,
            reason: "length-mismatch",
            oracleKind,
            candidateKind,
            oracleLength,
            candidateLength,
          },
          maxDifferences,
        );
      }
      const oracleArray = oracleValue as readonly unknown[];
      const candidateArray = candidateValue as readonly unknown[];
      const itemCount = Math.min(oracleArray.length, candidateArray.length, maxArrayItems);
      if (itemCount < Math.max(oracleArray.length, candidateArray.length)) truncated = true;
      for (let index = 0; index < itemCount; index += 1) {
        walk(oracleArray[index], candidateArray[index], `${path}[${index}]`, depth + 1);
      }
      return;
    }
    if (oracleKind === "object") {
      const oracleRecord = oracleValue as Record<string, unknown>;
      const candidateRecord = candidateValue as Record<string, unknown>;
      const keys = new Set([...Object.keys(oracleRecord), ...Object.keys(candidateRecord)]);
      for (const key of [...keys].toSorted()) {
        const oracleHasKey = Object.hasOwn(oracleRecord, key);
        const candidateHasKey = Object.hasOwn(candidateRecord, key);
        const childPath = `${path}.${key}`;
        if (!oracleHasKey) {
          appendDifference(
            differences,
            {
              path: childPath,
              reason: "missing-in-oracle",
              oracleKind: "missing",
              candidateKind: getKind(candidateRecord[key]),
              oracleLength: null,
              candidateLength: getLength(candidateRecord[key], getKind(candidateRecord[key])),
            },
            maxDifferences,
          );
          continue;
        }
        if (!candidateHasKey) {
          appendDifference(
            differences,
            {
              path: childPath,
              reason: "missing-in-candidate",
              oracleKind: getKind(oracleRecord[key]),
              candidateKind: "missing",
              oracleLength: getLength(oracleRecord[key], getKind(oracleRecord[key])),
              candidateLength: null,
            },
            maxDifferences,
          );
          continue;
        }
        walk(oracleRecord[key], candidateRecord[key], childPath, depth + 1);
      }
      return;
    }
    if (!Object.is(oracleValue, candidateValue)) {
      appendDifference(
        differences,
        {
          path,
          reason: "value-mismatch",
          oracleKind,
          candidateKind,
          oracleLength,
          candidateLength,
        },
        maxDifferences,
      );
    }
  };

  walk(oracle, candidate, "$", 0);
  return { equal: differences.length === 0 && !truncated, differences, comparedNodes, truncated };
};
