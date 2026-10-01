import { describe, expect, it } from "vitest";
import { canReprocess, checkUpload, isProcessing } from "./documents";

describe("checkUpload", () => {
  it.each(["policy.pdf", "FAQ.MD", "notes.txt", "warranty.docx"])("accepts %s", (name) => {
    expect(checkUpload({ name, size: 1024 })).toBeNull();
  });

  it.each(["sheet.csv", "image.png", "pdf", "archive.pdf.zip"])(
    "rejects the type of %s",
    (name) => {
      expect(checkUpload({ name, size: 1024 })).toBe("type");
    },
  );

  it("rejects empty files", () => {
    expect(checkUpload({ name: "a.txt", size: 0 })).toBe("empty");
  });

  it("rejects files over 20 MB but accepts exactly 20 MB", () => {
    const max = 20 * 1024 * 1024;
    expect(checkUpload({ name: "a.pdf", size: max })).toBeNull();
    expect(checkUpload({ name: "a.pdf", size: max + 1 })).toBe("size");
  });
});

describe("isProcessing", () => {
  it("is true while any document is pending or processing", () => {
    expect(isProcessing([{ status: "ready" }, { status: "pending" }])).toBe(true);
    expect(isProcessing([{ status: "processing" }])).toBe(true);
  });

  it("is false once every document has finished, failed included", () => {
    expect(isProcessing([{ status: "ready" }, { status: "failed" }])).toBe(false);
    expect(isProcessing([])).toBe(false);
  });
});

describe("canReprocess", () => {
  it.each([
    ["ready", true],
    ["failed", true],
    ["pending", false],
    ["processing", false],
  ] as const)("%s → %s", (status, expected) => {
    expect(canReprocess(status)).toBe(expected);
  });
});
