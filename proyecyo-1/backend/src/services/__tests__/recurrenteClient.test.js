const { createRecurrenteClient } = require("../recurrenteClient");
const { getCheckoutConfig } = require("../../config/recurrenteCheckout");
const config = { apiBase: "https://app.recurrente.com/api", sandboxId: "sbx_unit_fixture", origin: "http://localhost:5174", timeoutMs: 30 };
Object.defineProperty(config, "secretKey", { value: "fake-hu13-unit-key-never-use", enumerable: false });
const local = { referencia_local: "e6c87b4b-7fe4-43a4-b549-89b28f9ad0cf", monto_centavos: 6500, concepto: "Mantenimiento" };
const remote = { id: "ch_unit_fixture", status: "unpaid", checkout_url: "https://app.recurrente.com/checkout-session/ch_unit_fixture", currency: "GTQ", total_in_cents: 6500, live_mode: false };
const sandbox = { environment: "sandbox", sandbox_id: config.sandboxId };
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
let fetchImpl, client, beforeRequest;
beforeEach(() => {
  fetchImpl = jest.fn().mockResolvedValueOnce(json(sandbox)).mockResolvedValueOnce(json(remote, 201));
  client = createRecurrenteClient({ fetchImpl, configuration: () => config }); beforeRequest = jest.fn();
});

test("valida Sandbox antes del POST y envía el contrato oficial, referencias opacas y retorno", async () => {
  const result = await client.createCheckout(local, beforeRequest);
  expect(result).toEqual({ id_externo: remote.id, checkout_url: remote.checkout_url, estado_proveedor: "unpaid" });
  expect(fetchImpl.mock.calls[0][0]).toBe(`${config.apiBase}/test`);
  expect(beforeRequest).toHaveBeenCalledTimes(1);
  const [url, options] = fetchImpl.mock.calls[1];
  expect(url).toBe(`${config.apiBase}/checkouts`);
  expect(options.method).toBe("POST"); expect(options.redirect).toBe("error");
  expect(options.headers).toMatchObject({ "X-SECRET-KEY": config.secretKey, "Content-Type": "application/json" });
  expect(JSON.parse(options.body)).toEqual({
    items: [{ name: "NexusResidencial - Mantenimiento", amount_in_cents: 6500, currency: "GTQ", quantity: 1 }],
    metadata: { nexus_checkout_reference: local.referencia_local },
    success_url: `${config.origin}/residente/pagos/retorno?referencia=${local.referencia_local}`,
    cancel_url: `${config.origin}/residente/pagos/retorno?referencia=${local.referencia_local}`,
  });
  expect(options.body).not.toContain(config.secretKey); expect(JSON.stringify(result)).not.toContain(config.secretKey);
});

test("renta directa regresa al canal inquilino sin cambiar el contrato del proveedor",async()=>{
  await client.createCheckout({...local,rol:'inquilino'},beforeRequest);
  const sent=JSON.parse(fetchImpl.mock.calls[1][1].body);
  expect(sent.success_url).toBe(`${config.origin}/inquilino/pagos/retorno?referencia=${local.referencia_local}`);
  expect(sent.cancel_url).toBe(sent.success_url);
});
test.each([
  { environment: "live", sandbox_id: config.sandboxId },
  { environment: "legacy_test", sandbox_id: null },
  { environment: "sandbox", sandbox_id: "sbx_other" },
  {},
])("Sandbox incorrecto %j impide crear checkout", async (data) => {
  fetchImpl.mockReset().mockResolvedValue(json(data));
  await expect(client.createCheckout(local, beforeRequest)).rejects.toMatchObject({ code: "CHECKOUT_SANDBOX_MISMATCH", uncertain: false });
  expect(fetchImpl).toHaveBeenCalledTimes(1); expect(beforeRequest).not.toHaveBeenCalled();
});
test("no infiere el ambiente por el prefijo y exige el ID configurado", () => {
  const loaded = getCheckoutConfig({ RECURRENTE_SECRET_KEY: "opaque-fake-only", RECURRENTE_SANDBOX_ID: "sbx_unit_fixture", FRONTEND_ORIGIN: config.origin });
  expect(loaded.secretKey).toBe("opaque-fake-only"); expect(JSON.stringify(loaded)).not.toContain("opaque-fake-only");
  expect(() => getCheckoutConfig({})).toThrow(/no está configurado/);
});
test.each([400, 401, 403, 429, 500, 502, 503, 408, 409])("error HTTP %s no filtra cuerpo ni headers", async (status) => {
  fetchImpl.mockReset().mockResolvedValueOnce(json(sandbox)).mockResolvedValueOnce(json({ message: config.secretKey, headers: { "X-SECRET-KEY": config.secretKey } }, status));
  const error = await client.createCheckout(local, beforeRequest).catch((e) => e);
  expect(error.name).toBe("CheckoutError"); expect(error.uncertain).toBe(status >= 500 || [408, 409].includes(status));
  expect(error.message).not.toContain(config.secretKey); expect(JSON.stringify(error)).not.toContain(config.secretKey);
  expect(error).not.toHaveProperty("headers"); expect(error).not.toHaveProperty("cause");
});
test("401 del preflight impide el POST sin una operación externa incierta", async () => {
  fetchImpl.mockReset().mockResolvedValue(json({}, 401));
  await expect(client.createCheckout(local, beforeRequest)).rejects.toMatchObject({ code: "CHECKOUT_PROVIDER_AUTH", uncertain: false });
  expect(fetchImpl).toHaveBeenCalledTimes(1); expect(beforeRequest).not.toHaveBeenCalled();
});
test("timeout después del POST conserva incertidumbre incluso si fetch ignora AbortSignal", async () => {
  fetchImpl.mockReset().mockResolvedValueOnce(json(sandbox)).mockImplementationOnce(() => new Promise(() => {}));
  await expect(client.createCheckout(local, beforeRequest)).rejects.toMatchObject({ code: "CHECKOUT_TIMEOUT", uncertain: true });
  expect(fetchImpl.mock.calls[1][1].signal.aborted).toBe(true);
});
test("timeout al validar credenciales no envía un POST", async () => {
  fetchImpl.mockReset().mockImplementation(() => new Promise(() => {}));
  await expect(client.createCheckout(local, beforeRequest)).rejects.toMatchObject({ code: "CHECKOUT_SANDBOX_UNAVAILABLE", uncertain: false });
  expect(beforeRequest).not.toHaveBeenCalled();
});
test("fallo de red no copia errores originales que podrían contener la llave", async () => {
  fetchImpl.mockReset().mockResolvedValueOnce(json(sandbox)).mockRejectedValueOnce(new Error(`private ${config.secretKey}`));
  const error = await client.createCheckout(local, beforeRequest).catch((e) => e);
  expect(error).toMatchObject({ code: "CHECKOUT_PROVIDER_UNAVAILABLE", uncertain: true });
  expect(JSON.stringify(error)).not.toContain(config.secretKey);
});
test.each([
  { ...remote, checkout_url: undefined }, { ...remote, id: "invalid" }, { ...remote, status: "unknown" },
  { ...remote, currency: "USD" }, { ...remote, total_in_cents: 6501 }, { ...remote, live_mode: true },
])("respuesta incompleta o incoherente %j se rechaza", async (data) => {
  fetchImpl.mockReset().mockResolvedValueOnce(json(sandbox)).mockResolvedValueOnce(json(data));
  await expect(client.createCheckout(local, beforeRequest)).rejects.toMatchObject({ code: "CHECKOUT_INVALID_RESPONSE", uncertain: true });
});
test.each([
  "http://app.recurrente.com/checkout-session/ch_unit_fixture", "https://evil.example/checkout-session/ch_unit_fixture",
  "https://app.recurrente.com.evil.example/checkout-session/ch_unit_fixture", "https://app.recurrente.com@evil.example/checkout-session/ch_unit_fixture",
  "https://user:password@app.recurrente.com/checkout-session/ch_unit_fixture", "https://app.recurrente.com:444/checkout-session/ch_unit_fixture",
  "https://app.recurrente.com/checkout-session/ch_other", "https://app.recurrente.com/checkout-session/ch_unit_fixture?redirect=evil",
  "https://app.recurrente.com/checkout-session/ch_unit_fixture#fragment", "javascript:alert(1)",
])("solo permite la URL hospedada y ligada al checkout: %s", async (checkout_url) => {
  fetchImpl.mockReset().mockResolvedValueOnce(json(sandbox)).mockResolvedValueOnce(json({ ...remote, checkout_url }));
  await expect(client.createCheckout(local, beforeRequest)).rejects.toMatchObject({ code: "CHECKOUT_INVALID_RESPONSE", uncertain: true });
});
test.each([
  new Response("not-json", { headers: { "Content-Type": "application/json" } }),
  new Response("<html>error</html>", { headers: { "Content-Type": "text/html" } }),
])("respuesta que no cumple JSON resulta incierta", async (response) => {
  fetchImpl.mockReset().mockResolvedValueOnce(json(sandbox)).mockResolvedValueOnce(response);
  await expect(client.createCheckout(local, beforeRequest)).rejects.toMatchObject({ code: "CHECKOUT_INVALID_RESPONSE", uncertain: true });
});
test("reutilización consulta el ID persistido y nunca envía POST", async () => {
  fetchImpl.mockReset().mockResolvedValueOnce(json(sandbox)).mockResolvedValueOnce(json(remote));
  await client.getCheckout({ ...local, id_externo: remote.id });
  expect(fetchImpl.mock.calls[1][0]).toBe(`${config.apiBase}/checkouts/${remote.id}`);
  expect(fetchImpl.mock.calls.every(([, options]) => options.method === "GET")).toBe(true);
});

test("GET oficial sin checkout_url conserva URL persistida y validada", async () => {
  const { checkout_url, ...retrieved } = remote;
  fetchImpl.mockReset().mockResolvedValueOnce(json(sandbox)).mockResolvedValueOnce(json(retrieved));
  expect(await client.getCheckout({ ...local, id_externo: remote.id, checkout_url })).toEqual({ id_externo: remote.id, checkout_url, estado_proveedor: "unpaid" });
});
test("GET sin URL valida persistida no publica una URL inventada", async () => {
  const { checkout_url, ...retrieved } = remote;
  fetchImpl.mockReset().mockResolvedValueOnce(json(sandbox)).mockResolvedValueOnce(json(retrieved));
  await expect(client.getCheckout({ ...local, id_externo: remote.id, checkout_url: "https://evil.example" })).rejects.toMatchObject({ code: "CHECKOUT_INVALID_RESPONSE", uncertain: true });
});
test.each(["total_in_cents", "currency"])("GET sin %s impide verificar compatibilidad y queda incierto", async (field) => {
  const retrieved = { ...remote }; delete retrieved[field];
  fetchImpl.mockReset().mockResolvedValueOnce(json(sandbox)).mockResolvedValueOnce(json(retrieved));
  await expect(client.getCheckout({ ...local, id_externo: remote.id, checkout_url: remote.checkout_url })).rejects.toMatchObject({ code: "CHECKOUT_INVALID_RESPONSE", uncertain: true });
});
