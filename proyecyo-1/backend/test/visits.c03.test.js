const assert = require("node:assert/strict");
const test = require("node:test");

const { __private__ } = require("../src/services/visitsService");

test("ensureValidDpi acepta un DPI de exactamente 13 digitos", () => {
  assert.equal(__private__.ensureValidDpi("1234567890123"), "1234567890123");
});

test("ensureValidDpi normaliza DPI con espacios internos", () => {
  assert.equal(__private__.ensureValidDpi("1234567 890123"), "1234567890123");
});

test("ensureValidDpi lanza INVALID_DPI para menos de 13 digitos", () => {
  assert.throws(
    () => __private__.ensureValidDpi("123456789012"),
    (error) => error.status === 400 && error.code === "INVALID_DPI",
  );
});

test("ensureValidDpi lanza INVALID_DPI para mas de 13 digitos", () => {
  assert.throws(
    () => __private__.ensureValidDpi("12345678901234"),
    (error) => error.status === 400 && error.code === "INVALID_DPI",
  );
});

test("ensureValidDpi lanza INVALID_DPI si contiene letras", () => {
  assert.throws(
    () => __private__.ensureValidDpi("123456789012A"),
    (error) => error.status === 400 && error.code === "INVALID_DPI",
  );
});

test("ensureValidDpi permite valor vacio (DPI opcional)", () => {
  assert.equal(__private__.ensureValidDpi(""), "");
});
