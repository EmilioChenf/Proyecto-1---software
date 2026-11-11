jest.mock("../../database/mysql", () => ({ query: jest.fn() }));
const { isValidNit } = require("../felService");

test("valida el dígito verificador del NIT guatemalteco (módulo 11, 10 = K)", () => {
  expect(isValidNit("576442-4")).toBe(true);
  expect(isValidNit("5764426")).toBe(false);
  expect(isValidNit("1000002K")).toBe(true);
  expect(isValidNit("1000002-k")).toBe(true);
  expect(isValidNit("CF")).toBe(true);
  expect(isValidNit("abc")).toBe(false);
});
