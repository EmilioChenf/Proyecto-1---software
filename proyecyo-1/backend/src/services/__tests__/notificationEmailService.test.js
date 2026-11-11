jest.mock("../../database/mysql", () => ({ query: jest.fn() }));

const { createNotificationEmailDispatcher, buildNotificationEmail, MAX_ATTEMPTS } = require("../notificationEmailService");
const { renderEmailLayout } = require("../emailService");

function fakeDb(rows) {
  const calls = [];
  const db = jest.fn(async (sql, params) => {
    calls.push({ sql: sql.replace(/\s+/g, " ").trim(), params });
    if (/^SELECT n\.id_notificacion/.test(sql.trim())) return rows;
    return { affectedRows: 1 };
  });
  return { db, calls };
}

const visitArrival = { id_notificacion: 7, tipo: "LLEGADA_VISITA", titulo: "Tu visita ya llegó", mensaje: "Andrea llegó a la garita.", correo_intentos: 0, nombre: "Residente Demo", correo: "residente@test.com", activo: 1, rol: "residente" };

describe("despachador de correos de notificaciones", () => {
  test("envia la notificacion pendiente y la marca como ENVIADO", async () => {
    const { db, calls } = fakeDb([visitArrival]);
    const send = jest.fn(async () => ({ delivered: true }));
    const stats = await createNotificationEmailDispatcher({ db, send, configured: () => true }).processBatch();

    expect(stats).toEqual({ sent: 1, failed: 0, skipped: 0 });
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ to: "residente@test.com", subject: "[Visitas] Tu visita ya llegó" }));
    expect(calls.some((c) => c.sql.includes("SET correo_estado = 'ENVIANDO'") && c.params[0] === 7)).toBe(true);
    expect(calls.some((c) => c.sql.includes("SET correo_estado = 'ENVIADO'") && c.params[0] === 7)).toBe(true);
  });

  test("si el envio falla reprograma el reintento sin perder la notificacion", async () => {
    const { db, calls } = fakeDb([visitArrival]);
    const send = jest.fn(async () => { throw Object.assign(new Error("timeout"), { code: "ETIMEDOUT" }); });
    const log = { error: jest.fn() };
    const stats = await createNotificationEmailDispatcher({ db, send, configured: () => true, log }).processBatch();

    expect(stats.failed).toBe(1);
    const retry = calls.find((c) => c.params && c.params[0] === "PENDIENTE");
    expect(retry.params).toEqual(["PENDIENTE", 1, "ETIMEDOUT", 1, 7]);
  });

  test("tras el ultimo intento la marca como FALLIDO", async () => {
    const { db, calls } = fakeDb([{ ...visitArrival, correo_intentos: MAX_ATTEMPTS - 1 }]);
    const send = jest.fn(async () => { throw new Error("rechazado"); });
    await createNotificationEmailDispatcher({ db, send, configured: () => true, log: { error: jest.fn() } }).processBatch();
    expect(calls.find((c) => c.params && c.params[0] === "FALLIDO").params).toEqual(["FALLIDO", MAX_ATTEMPTS, "rechazado", 7]);
  });

  test("omite usuarios inactivos o sin correo", async () => {
    const { db, calls } = fakeDb([{ ...visitArrival, activo: 0 }, { ...visitArrival, id_notificacion: 8, correo: "" }]);
    const send = jest.fn();
    const stats = await createNotificationEmailDispatcher({ db, send, configured: () => true }).processBatch();
    expect(send).not.toHaveBeenCalled();
    expect(stats.skipped).toBe(2);
    expect(calls.filter((c) => c.sql.includes("'OMITIDO', correo_error = ?")).map((c) => c.params)).toEqual([["USUARIO_INACTIVO", 7], ["SIN_CORREO", 8]]);
  });

  test("no hace nada si el correo no esta configurado", async () => {
    const { db } = fakeDb([visitArrival]);
    const stats = await createNotificationEmailDispatcher({ db, send: jest.fn(), configured: () => false }).processBatch();
    expect(stats).toEqual({ sent: 0, failed: 0, skipped: 0 });
    expect(db).not.toHaveBeenCalled();
  });

  test("descarta avisos antiguos y libera envios a medias antes de enviar", async () => {
    const { db, calls } = fakeDb([]);
    await createNotificationEmailDispatcher({ db, send: jest.fn(), configured: () => true }).processBatch();
    expect(calls[0].sql).toContain("SET correo_estado = 'PENDIENTE' WHERE correo_estado = 'ENVIANDO'");
    expect(calls[1].sql).toContain("correo_error = 'ANTIGUA'");
  });
});

describe("contenido de los correos", () => {
  test("los recordatorios de pago llevan al estado de cuenta segun el rol", () => {
    const email = buildNotificationEmail({ tipo: "CUOTA_PROXIMA", titulo: "Tu cuota vence pronto", mensaje: "Vence el 15.", nombre: "Ana", rol: "inquilino" });
    expect(email.subject).toBe("[Pagos] Tu cuota vence pronto");
    expect(email.html).toContain("/inquilino/estado-cuenta");
    expect(email.text).toContain("Hola Ana,");
  });

  test("la salida de la visita y los comunicados usan su propia etiqueta", () => {
    expect(buildNotificationEmail({ tipo: "SALIDA_VISITA", titulo: "Tu visita ya salió", mensaje: "x", rol: "residente" }).subject).toBe("[Visitas] Tu visita ya salió");
    expect(buildNotificationEmail({ tipo: "COMUNICADO", titulo: "Piscina cerrada", mensaje: "x", rol: "residente" }).html).toContain("/residente/comunicados");
  });

  test("escapa el HTML de los datos escritos por usuarios", () => {
    const html = renderEmailLayout({ heading: "<script>alert(1)</script>", paragraphs: ['Visita de "Ana" <img src=x>'] });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).not.toContain("<img src=x>");
    expect(html).toContain("&lt;script&gt;");
  });
});
