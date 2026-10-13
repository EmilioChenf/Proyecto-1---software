const zlib = require("node:zlib");
// Read PDFKit's standard-font text from real, compressed page streams. Used only
// by tests to assert content, in addition to checking the PDF header/structure.
function receiptPdfText(pdf) {
  const data = pdf.toString("latin1"); let text = "";
  for (const match of data.matchAll(/<<(.*?)>>\s*stream\r?\n/gs)) {
    // PDFKit writes a direct byte length. A compressed stream can itself end
    // in CR, so treating CR before the delimiter as whitespace truncates it.
    const length = match[1].match(/\/Length\s+(\d+)\b/);
    if (!length) throw new Error("PDFKit stream is missing its byte length");
    const start = match.index + match[0].length;
    let stream = pdf.subarray(start, start + Number(length[1]));
    if (match[1].includes("FlateDecode")) stream = zlib.inflateSync(stream);
    for (const encoded of stream.toString("latin1").matchAll(/<([0-9a-f]+)>/gi)) text += Buffer.from(encoded[1], "hex").toString("latin1");
  }
  return text;
}
module.exports = { receiptPdfText };
