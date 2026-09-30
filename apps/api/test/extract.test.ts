import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { detectFormat, ExtractionError, extractText } from "../src/ingestion/extract";

const fixture = async (name: string) =>
  new Uint8Array(await readFile(new URL(`./fixtures/${name}`, import.meta.url)));
const utf8 = (text: string) => new TextEncoder().encode(text);

describe("detectFormat", () => {
  it("accepts files whose content matches the extension", async () => {
    expect(detectFormat("Policy.PDF", await fixture("policy.pdf"))).toBe("pdf");
    expect(detectFormat("warranty.docx", await fixture("warranty.docx"))).toBe("docx");
    expect(detectFormat("faq.md", utf8("# FAQ\nAñoranza"))).toBe("text");
  });

  it.each([
    ["a text file renamed to .pdf", "fake.pdf", utf8("not a pdf")],
    ["a pdf renamed to .docx", "fake.docx", utf8("%PDF-1.4 ...")],
    ["binary content with a .txt name", "blob.txt", new Uint8Array([0x4d, 0x5a, 0x00, 0x01])],
    ["invalid UTF-8 text", "latin1.txt", new Uint8Array([0x63, 0x61, 0xf1, 0x61])],
    ["an unsupported extension", "sheet.xlsx", new Uint8Array([0x50, 0x4b, 0x03, 0x04])],
    ["no extension", "README", utf8("hello")],
  ])("rejects %s", (_label, name, bytes) => {
    expect(detectFormat(name, bytes)).toBeNull();
  });
});

describe("extractText", () => {
  it("extracts text from a PDF", async () => {
    const text = await extractText("pdf", await fixture("policy.pdf"));
    expect(text).toContain("Closer financing policy");
    expect(text).toContain("Down payment starts at 20 percent.");
  });

  it("extracts text from a DOCX", async () => {
    const text = await extractText("docx", await fixture("warranty.docx"));
    expect(text).toContain("Warranty terms");
    expect(text).toContain("6 month warranty");
  });

  it("decodes UTF-8 text including accents", async () => {
    expect(await extractText("text", utf8("Financiación en cuotas"))).toBe(
      "Financiación en cuotas",
    );
  });

  it("reports a corrupt file as an ExtractionError", async () => {
    await expect(extractText("pdf", utf8("%PDF-1.4 garbage"))).rejects.toBeInstanceOf(
      ExtractionError,
    );
    await expect(
      extractText("docx", new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2])),
    ).rejects.toBeInstanceOf(ExtractionError);
  });
});
