const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");

const { createApp } = require("../src/app");
const { SECURITY_RATE_LIMITS } = require("../src/middlewares/securityRateLimits");
const { validateChangePayload } = require("../src/services/passwordChangeService");

// HU-C01: estas peticiones fallan en validacion o autenticacion antes de tocar la
// base de datos, asi que el limite del servidor se prueba sin MySQL.
const SENSITIVE_POSTS = [
  ["login", "/login", { email: "", password: "" }, 400],
  ["passwordForgot", "/auth/password/forgot", { email: "no-es-correo" }, 400],
  ["passwordReset", "/auth/password/reset", { token: "x", password: "x" }, 400],
  ["passwordChange", "/auth/password/change", { currentPassword: "a", newPassword: "b", confirmPassword: "b" }, 401],
  // HU-C01.5: POST sensibles fuera de la autenticacion.
  ["publicForm", "/public/solicitudes-demo", {}, 400],
  ["paymentStart", "/residente/pagos/recurrente/checkout", { id_cuota: 1 }, 401],
  ["guardQr", "/guardia/registrar-ingreso", { qrToken: "x" }, 401],
];

describe("HU-C01 rate limiting de POST sensibles", () => {
  for (const [name, path, body, normalStatus] of SENSITIVE_POSTS) {
    it(`${path} responde 429 RATE_LIMITED al superar ${SECURITY_RATE_LIMITS[name].limit} intentos`, async () => {
      const app = createApp();
      const { limit } = SECURITY_RATE_LIMITS[name];
      for (let attempt = 1; attempt <= limit; attempt++) {
        const response = await request(app).post(path).send(body);
        assert.equal(response.status, normalStatus, `intento ${attempt} sigue el flujo normal`);
      }
      const blocked = await request(app).post(path).send(body);
      assert.equal(blocked.status, 429);
      assert.deepEqual(blocked.body, { message: SECURITY_RATE_LIMITS[name].message, code: "RATE_LIMITED" });
      assert.ok(Number(blocked.headers["retry-after"]) > 0, "indica cuando reintentar");
      assert.ok(blocked.headers.ratelimit || blocked.headers["ratelimit-limit"], "expone los encabezados estandar");
    });
  }

  it("cada instancia de la app tiene su propio contador", async () => {
    const first = createApp();
    for (let i = 0; i <= SECURITY_RATE_LIMITS.passwordForgot.limit; i++) {
      await request(first).post("/auth/password/forgot").send({ email: "x" });
    }
    assert.equal((await request(first).post("/auth/password/forgot").send({ email: "x" })).status, 429);
    assert.equal((await request(createApp()).post("/auth/password/forgot").send({ email: "x" })).status, 400);
  });

  it("HU-C01.5: el limite de pagos es comun a todas las rutas que inician un cobro", async () => {
    const app = createApp();
    const { limit } = SECURITY_RATE_LIMITS.paymentStart;
    for (let attempt = 0; attempt < limit; attempt++) {
      const path = attempt % 2 ? "/inquilino/pagos-simulados" : "/residente/pagos/recurrente/reintentar";
      assert.equal((await request(app).post(path).send({})).status, 401);
    }
    const blocked = await request(app).post("/residente/pagos-simulados").send({});
    assert.equal(blocked.status, 429);
    assert.equal(blocked.body.code, "RATE_LIMITED");
  });

  it("HU-C01.6: las lecturas de QR aceptadas no consumen el limite del guardia", async () => {
    const express = require("express");
    const { createSecurityRateLimiters, GUARD_QR_PATHS } = require("../src/middlewares/securityRateLimits");
    const app = express();
    const limits = createSecurityRateLimiters();
    app.post(GUARD_QR_PATHS, limits.guardQr, (req, res) => {
      res.status(req.query.ok ? 200 : 409).json({});
    });
    const { limit } = SECURITY_RATE_LIMITS.guardQr;
    for (let i = 0; i < limit * 2; i++) {
      assert.equal((await request(app).post("/guardia/registrar-ingreso?ok=1")).status, 200, "uso normal sin limite");
    }
    for (let i = 0; i < limit; i++) {
      assert.equal((await request(app).post("/guardia/validar-qr")).status, 409);
    }
    assert.equal((await request(app).post("/guardia/registrar-salida")).status, 429);
  });

  it("los GET no consumen el limite de los POST sensibles", async () => {
    const app = createApp();
    for (let i = 0; i < SECURITY_RATE_LIMITS.passwordChange.limit + 2; i++) {
      await request(app).get("/auth/session");
    }
    const response = await request(app).post("/auth/password/change").send({});
    assert.equal(response.status, 401);
  });
});

describe("HU-C01 respuestas HTTP estandarizadas", () => {
  it("sin sesion: 401 SESSION_REQUIRED, tambien para cambiar contrasena", async () => {
    const response = await request(createApp()).post("/auth/password/change")
      .send({ currentPassword: "Actual123", newPassword: "Nueva1234", confirmPassword: "Nueva1234", id_usuario: 1 });
    assert.equal(response.status, 401);
    assert.deepEqual(response.body, { message: "Sesion invalida.", code: "SESSION_REQUIRED" });
  });

  it("un token con firma invalida no autentica", async () => {
    const response = await request(createApp()).post("/auth/password/change")
      .set("Authorization", "Bearer abc.def").send({});
    assert.equal(response.status, 401);
    assert.equal(response.body.code, "SESSION_REQUIRED");
  });

  it("las cabeceras simuladas de pruebas no permiten cambiar contrasenas", async () => {
    const response = await request(createApp()).post("/auth/password/change")
      .set("x-user-id", "1").set("x-user-role", "admin")
      .send({ currentPassword: "Actual123", newPassword: "Nueva1234", confirmPassword: "Nueva1234" });
    assert.equal(response.status, 401);
    assert.equal(response.body.code, "SESSION_REQUIRED");
  });
});

describe("HU-C01 validaciones del cambio de contrasena", () => {
  const valid = { currentPassword: "Actual123", newPassword: "Nueva1234", confirmPassword: "Nueva1234" };
  const expectCode = (payload, code, field) => {
    assert.throws(() => validateChangePayload(payload), (error) => {
      assert.equal(error.status, 400);
      assert.equal(error.code, code);
      if (field) assert.ok(error.errores.some((item) => item.field === field), `marca ${field}`);
      assert.doesNotMatch(error.message, /Actual123|Nueva1234/, "no repite contrasenas en el error");
      return true;
    });
  };

  it("acepta un cambio valido", () => {
    assert.deepEqual(validateChangePayload(valid), { currentPassword: "Actual123", newPassword: "Nueva1234" });
  });

  it("campos faltantes indican cada campo", () => {
    assert.throws(() => validateChangePayload({}), (error) => {
      assert.equal(error.code, "PASSWORD_FIELDS_REQUIRED");
      assert.deepEqual(error.errores.map((item) => item.field), ["currentPassword", "newPassword", "confirmPassword"]);
      return true;
    });
    expectCode({ ...valid, currentPassword: "" }, "PASSWORD_FIELDS_REQUIRED", "currentPassword");
    expectCode({ ...valid, newPassword: 12345678 }, "PASSWORD_FIELDS_REQUIRED", "newPassword");
  });

  it("confirmacion diferente", () => {
    expectCode({ ...valid, confirmPassword: "Nueva12345" }, "PASSWORD_CONFIRMATION_MISMATCH", "confirmPassword");
  });

  it("aplica la politica existente de recuperacion (8-128, letras y numeros)", () => {
    for (const weak of ["Corta1", "solamenteletras", "1234567890", `A1${"x".repeat(127)}`]) {
      expectCode({ ...valid, newPassword: weak, confirmPassword: weak }, "PASSWORD_POLICY", "newPassword");
    }
  });

  it("rechaza espacios al inicio o al final porque el login los recorta", () => {
    for (const spaced of [" Nueva1234", "Nueva1234 "]) {
      expectCode({ ...valid, newPassword: spaced, confirmPassword: spaced }, "PASSWORD_POLICY", "newPassword");
    }
  });
});
