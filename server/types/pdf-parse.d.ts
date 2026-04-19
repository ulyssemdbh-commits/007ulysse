declare module "pdf-parse/lib/pdf-parse.js" {
  interface PdfParseResult {
    text: string;
    numpages?: number;
    numrender?: number;
    info?: Record<string, unknown>;
    metadata?: unknown;
    version?: string;
  }
  type PdfParseFn = (
    data: Buffer | Uint8Array,
    options?: Record<string, unknown>,
  ) => Promise<PdfParseResult>;
  const pdfParse: PdfParseFn;
  export default pdfParse;
}

declare module "pdf-parse" {
  export { default } from "pdf-parse/lib/pdf-parse.js";
}
