jest.mock("../../database/mysql", () => ({ query: jest.fn() }));
const { query } = require("../../database/mysql");
const { getPaymentReceipt, getResidentTransactionReceipt, listResidentRecurrenteReceipts, createPaymentReceiptPdf } = require("../paymentReceiptService");
const { receiptPdfText } = require("../../../test/integration/support/receiptPdfText");
const row = { id_pago: 395, id_cuota: 171, monto_pagado: "5.00", monto_cuota: "5.00", fecha_pago: "2026-10-02", fecha_limite: "2026-10-09",
  servicio: "HU13 Sandbox Q5 TEST", titular_nombre: "Residente Demo", titular_correo: "residente@test.com", numero: "302", torre: "B", id_casa: 1,
  pago_origen: "RECURRENTE", pago_ambiente: "sandbox", id_transaccion: 296, transaccion_pago: 395, transaccion_cuota: 171, transaccion_casa: 1,
  transaccion_usuario: 3, transaccion_checkout: 433, transaccion_estado: "CONFIRMADA", monto_centavos: 500, moneda: "GTQ", transaccion_ambiente: "sandbox",
  referencia_transaccion: "in_y4hil51d", referencia_pago_externa: "pa_xzdhbyna", confirmado_en: "2026-10-02 17:44:22.089535", capital_aplicado_centavos: 500,
  recargo_aplicado_centavos: 0, id_checkout: 433, checkout_cuota: 171, checkout_casa: 1, checkout_usuario: 3, checkout_estado: "CONFIRMADO", estado_proveedor: "paid",
  checkout_monto: 500, checkout_moneda: "GTQ", checkout_ambiente: "sandbox" };
beforeEach(() => query.mockReset());
test("comprobante real deriva número estable, fecha contable y relaciones confirmadas", async () => {
  query.mockResolvedValue([row]); const first = await getPaymentReceipt(3, "residente", 395), second = await getPaymentReceipt(3, "residente", "395");
  expect(second).toEqual(first); expect(first).toMatchObject({ numero_comprobante: "NXR-00000395", fecha_pago: "2026-10-02", monto_pagado: 5,
    estado: "CONFIRMADO", moneda: "GTQ", proveedor: "Recurrente", titular_nombre: "Residente Demo", unidad: "B-302", ambiente: "sandbox",
    id_transaccion: 296, id_checkout: 433, referencia_transaccion: "in_y4hil51d" });
  expect(query.mock.calls.every(([sql, args]) => sql.trim().startsWith("SELECT") && args[0] === 3)).toBe(true);
});
test.each([
  ["transaccion_estado", "FALLIDA"], ["transaccion_estado", "CANCELADA"], ["transaccion_estado", "PENDIENTE"],
  ["transaccion_pago", null], ["transaccion_pago", 1], ["confirmado_en", null], ["checkout_estado", "PENDIENTE"],
  ["estado_proveedor", "unpaid"], ["monto_centavos", 600], ["checkout_monto", 600], ["capital_aplicado_centavos", null],
  ["recargo_aplicado_centavos", 1], ["pago_origen", "SIMULADO"], ["pago_ambiente", "academic"], ["transaccion_ambiente", "production"],
  ["checkout_ambiente", "production"], ["moneda", "USD"], ["checkout_moneda", "USD"], ["transaccion_cuota", 998], ["checkout_cuota", 998],
  ["transaccion_casa", 2], ["checkout_casa", 2], ["transaccion_usuario", 4], ["transaccion_checkout", 937],
  ["referencia_transaccion", "secret=FAKE_ONLY"], ["referencia_pago_externa", "unsafe\nreference"],
  ["id_transaccion", null], ["id_checkout", null],
])("inconsistencia %s impide comprobante real", async (key, value) => {
  query.mockResolvedValue([{ ...row, [key]: value }]); await expect(getPaymentReceipt(3, "residente", 395)).rejects.toMatchObject({ status: 409, code: "RECEIPT_NOT_CONFIRMED" });
});
test("origen Recurrente sin transacción vinculada no emite", async () => {
  query.mockResolvedValue([{ ...row, id_transaccion: null, transaccion_estado: null }]); await expect(getPaymentReceipt(3, "residente", 395)).rejects.toMatchObject({ status: 409 });
});
test("lista excluye asociaciones inconsistentes y usa una sola consulta autorizada", async () => {
  query.mockResolvedValue([row, { ...row, estado_proveedor: "unpaid" }]); expect(await listResidentRecurrenteReceipts(3)).toHaveLength(1);
  expect(query).toHaveBeenCalledTimes(1); expect(query.mock.calls[0][1]).toEqual([3]);
});
test.each(["FALLIDA", "CANCELADA", "PENDIENTE"])("transacción %s sin pago no permite comprobante", async (estado) => {
  query.mockResolvedValue([{ estado, id_pago: null }]); await expect(getResidentTransactionReceipt(3, 486)).rejects.toMatchObject({ status: 409 }); expect(query).toHaveBeenCalledTimes(1);
});
test("identificadores inexistentes/ajenos devuelven 404 sin datos", async () => {
  query.mockResolvedValue([]); await expect(getResidentTransactionReceipt(4, 296)).rejects.toMatchObject({ status: 404 }); await expect(getPaymentReceipt(4, "residente", 395)).rejects.toMatchObject({ status: 404 });
});
test.each([0, -1, 1.2, "1e3", "1 OR 1=1", 2147483648])("ID inválido %s no llega a SQL", async (id) => {
  await expect(getPaymentReceipt(3, "residente", id)).rejects.toMatchObject({ status: 400 }); expect(query).not.toHaveBeenCalled();
});
test("administrador no adquiere nuevos permisos", async () => {
  await expect(getPaymentReceipt(3, "administrador", 395)).rejects.toMatchObject({ status: 403 }); expect(query).not.toHaveBeenCalled();
});
test("respuesta solo permite datos del comprobante, sin correo innecesario ni secretos/payloads", async () => {
  query.mockResolvedValue([{ ...row, raw: "PRIVATE_TEST_ONLY", secretKey: "PRIVATE_TEST_ONLY", svix_signature: "PRIVATE_TEST_ONLY" }]);
  const result = await getPaymentReceipt(3, "residente", 395); expect(JSON.stringify(result)).not.toMatch(/PRIVATE_TEST|correo|signature|secret|payload/);
});
test("PDF real contiene los datos esenciales y Sandbox visible", async () => {
  query.mockResolvedValue([row]); const pdf = await createPaymentReceiptPdf(await getPaymentReceipt(3, "residente", 395));
  expect(pdf.subarray(0, 4).toString()).toBe("%PDF"); const text = receiptPdfText(pdf);
  for (const value of ["NEXUS RESIDENCIAL", "Comprobante de pago", "SANDBOX / PRUEBA", "NXR-00000395", "2026-10-02", "HU13 Sandbox Q5 TEST", "Q5.00", "GTQ", "Confirmado", "Recurrente", "Residente Demo", "B-302", "in_y4hil51d", "Pago 395"]) expect(text).toContain(value);
});
test("PDF conserva referencias externas extensas sin truncar datos autoritativos", async () => {
  const reference = `in_${"a".repeat(188)}`;
  query.mockResolvedValue([{ ...row, referencia_transaccion: reference }]);
  const text = receiptPdfText(await createPaymentReceiptPdf(await getPaymentReceipt(3, "residente", 395)));
  expect(text).toContain(reference); expect(text).toContain("Pago 395");
});
test("PDF lleva el nombre y color del residencial cuando tiene marca propia", async () => {
  query.mockResolvedValue([row]);
  const brand = { nombre: "Residencial Las Brisas", color: "#0E7490", logo: null, personalizada: true };
  const text = receiptPdfText(await createPaymentReceiptPdf(await getPaymentReceipt(3, "residente", 395), brand));
  expect(text).toContain("RESIDENCIAL LAS BRISAS");
  expect(text).toContain("Documento generado por Residencial Las Brisas con NexusResidencial.");
});
