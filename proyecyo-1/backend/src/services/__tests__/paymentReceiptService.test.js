jest.mock("../../database/mysql", () => ({ query: jest.fn() }));

const { query } = require("../../database/mysql");
const { getPaymentReceipt, createPaymentReceiptPdf, paymentReference } = require("../paymentReceiptService");

const row = { id_pago: 7, id_cuota: 3, monto_pagado: "250.00", monto_cuota: "250.00",
  fecha_pago: "2026-08-01", fecha_limite: "2026-08-05", servicio: "Mantenimiento",
  titular_nombre: "Ana", titular_correo: "ana@test.com", numero: "101", torre: "A" };

beforeEach(() => query.mockReset());

test("descarga un pago propio con consulta parametrizada", async () => {
  query.mockResolvedValue([row]);
  const receipt = await getPaymentReceipt(12, "residente", 7);
  expect(receipt.numero_comprobante).toBe("NXR-00000007");
  expect(query.mock.calls[0][1]).toEqual([12, 7]);
});

test("un pago inexistente o ajeno no se expone", async () => {
  query.mockResolvedValue([]);
  await expect(getPaymentReceipt(99, "residente", 7)).rejects.toMatchObject({ status: 404 });
  expect(query.mock.calls[0][1]).toEqual([99, 7]);
});

test("inquilino exige atribución financiera histórica y usa parametros", async () => {
  query.mockResolvedValue([]);
  await expect(getPaymentReceipt(21, "inquilino", 8)).rejects.toMatchObject({ status: 404 });
  expect(query.mock.calls[0][0]).toContain('cu.id_responsable=usuario.id_usuario');
  expect(query.mock.calls[0][1]).toEqual([21, 8]);
});

test("genera un PDF valido", async () => {
  const pdf = await createPaymentReceiptPdf({ ...row, numero_comprobante: paymentReference(7), monto_pagado: 250,
    titular_nombre: row.titular_nombre, titular_correo: row.titular_correo, unidad: "A-101" });
  expect(Buffer.isBuffer(pdf)).toBe(true);
  expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
  expect(pdf.length).toBeGreaterThan(500);
});
