// Minimal typing for the pdfmake 0.3 server build (no @types package for this version).
declare module 'pdfmake' {
  interface OutputDocument { getBuffer(): Promise<Buffer> }
  interface PdfMake {
    setFonts(fonts: Record<string, { normal: string; bold?: string; italics?: string; bolditalics?: string }>): void;
    setLocalAccessPolicy(cb: (path: string) => boolean): void;
    setUrlAccessPolicy(cb: (url: string) => boolean): void;
    createPdf(def: Record<string, unknown>): OutputDocument;
  }
  const pdfmake: PdfMake;
  export default pdfmake;
}
