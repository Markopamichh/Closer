import { describe, expect, it } from "vitest";
import { messages } from "./messages";

/** Every leaf string with its dotted key. */
function leaves(node: unknown, path = ""): [string, string][] {
  if (typeof node === "string") return [[path, node]];
  if (typeof node !== "object" || node === null) return [];
  return Object.entries(node).flatMap(([key, value]) =>
    leaves(value, path ? `${path}.${key}` : key),
  );
}

describe("messages", () => {
  // ICU (next-intl) reads "<…>" as rich-text tags: a literal "</body>" in a message throws
  // UNMATCHED_CLOSING_TAG at render time, which no typecheck catches. We use no rich text,
  // so pass markup-like text as a value instead: t("key", { tag: "</body>" }).
  it.each(Object.entries(messages))("%s has no '<' in any message", (_locale, catalog) => {
    const offending = leaves(catalog).filter(([, text]) => text.includes("<"));
    expect(offending).toEqual([]);
  });
});
