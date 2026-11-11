const { getPaymentReceipt, getResidentTransactionReceipt, listResidentRecurrenteReceipts, createPaymentReceiptPdf } = require("../services/paymentReceiptService");

async function getPaymentReceiptData(req, res, next) {
  try {
    const payment = await getPaymentReceipt(req.authUser.id, req.authUser.role, req.params.paymentId);
    res.set("Cache-Control", "private, no-store").json(payment);
  } catch (error) { next(error); }
}
async function getTransactionReceiptData(req, res, next) {
  try {
    const payment = await getResidentTransactionReceipt(req.authUser.id, req.params.transactionId);
    res.set("Cache-Control", "private, no-store").json(payment);
  } catch (error) { next(error); }
}
async function listRecurrenteReceiptData(req, res, next) {
  try { res.set("Cache-Control", "private, no-store").json(await listResidentRecurrenteReceipts(req.authUser.id)); }
  catch (error) { next(error); }
}

async function downloadPaymentReceipt(req, res, next) {
  try {
    const payment = await getPaymentReceipt(req.authUser.id, req.authUser.role, req.params.paymentId);
    const pdf = await createPaymentReceiptPdf(payment, await require("../services/pdfBrand").loadPdfBrand());
    res.set({ "Cache-Control": "private, no-store", "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="comprobante-${payment.numero_comprobante}.pdf"`,
      "Content-Length": pdf.length });
    res.status(200).send(pdf);
  } catch (error) { next(error); }
}

module.exports = { downloadPaymentReceipt, getPaymentReceiptData, getTransactionReceiptData, listRecurrenteReceiptData };
