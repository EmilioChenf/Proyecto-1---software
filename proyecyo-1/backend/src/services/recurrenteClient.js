const { getCheckoutConfig } = require("../config/recurrenteCheckout");
const { CheckoutError } = require("./recurrenteCheckoutErrors");
const { validCheckoutId, validateCheckoutUrl } = require("../utils/recurrenteCheckoutUrl");
const PROVIDER_STATES = new Set(["unpaid", "paid", "payment_in_progress", "expired"]);

function createRecurrenteClient({ fetchImpl = (...args) => globalThis.fetch(...args), configuration = getCheckoutConfig } = {}) {
  async function request(config, path, { method = "GET", body, uncertain = false } = {}) {
    const controller = new AbortController();
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new CheckoutError("CHECKOUT_TIMEOUT", { uncertain })); }, config.timeoutMs);
    });
    const operation = async () => {
      const response = await fetchImpl(`${config.apiBase}${path}`, {
        method, redirect: "error", signal: controller.signal,
        headers: { "X-SECRET-KEY": config.secretKey, "Content-Type": "application/json", Accept: "application/json" },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        const status = response.status;
        const mayHaveCreated = uncertain && (status >= 500 || [408, 409].includes(status) || status < 400);
        const code = [401, 403].includes(status) ? "CHECKOUT_PROVIDER_AUTH"
          : status === 429 ? "CHECKOUT_PROVIDER_RATE_LIMIT"
            : status >= 500 || status === 408 ? "CHECKOUT_PROVIDER_UNAVAILABLE" : "CHECKOUT_PROVIDER_REJECTED";
        throw new CheckoutError(code, { uncertain: mayHaveCreated });
      }
      const type = response.headers.get("content-type") || "";
      if (!/^application\/(?:[a-z0-9.+-]+\+)?json(?:;|$)/i.test(type)) {
        await response.body?.cancel().catch(() => {});
        throw new CheckoutError("CHECKOUT_INVALID_RESPONSE", { uncertain });
      }
      const text = await response.text();
      if (text.length > 65536) throw new CheckoutError("CHECKOUT_INVALID_RESPONSE", { uncertain });
      try {
        const data = JSON.parse(text);
        if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error();
        return data;
      } catch { throw new CheckoutError("CHECKOUT_INVALID_RESPONSE", { uncertain }); }
    };
    try { return await Promise.race([operation(), timeout]); }
    catch (error) {
      if (error instanceof CheckoutError) throw error;
      // Never attach fetch errors, request headers, provider bodies or causes.
      throw new CheckoutError("CHECKOUT_PROVIDER_UNAVAILABLE", { uncertain });
    } finally { clearTimeout(timer); controller.abort(); }
  }
  async function sandbox(config) {
    let data;
    try { data = await request(config, "/test"); }
    catch (error) {
      if (["CHECKOUT_PROVIDER_AUTH", "CHECKOUT_PROVIDER_RATE_LIMIT"].includes(error.code)) throw error;
      throw new CheckoutError("CHECKOUT_SANDBOX_UNAVAILABLE");
    }
    if (data.environment !== "sandbox" || data.sandbox_id !== config.sandboxId) {
      throw new CheckoutError("CHECKOUT_SANDBOX_MISMATCH");
    }
  }
  function checkout(data, expected, config) {
    const allowed = {
      id_externo: validCheckoutId(data.id) ? data.id : null,
      estado_proveedor: PROVIDER_STATES.has(data.status) ? data.status : null,
      // GET's official response does not include checkout_url. Keep the validated URL
      // from creation only when querying that same, already persisted checkout.
      checkout_url: validateCheckoutUrl(data.checkout_url === undefined && expected.id_externo
        ? expected.checkout_url : data.checkout_url, data.id),
    };
    if (!allowed.id_externo || !allowed.estado_proveedor || !allowed.checkout_url
      || (expected.id_externo && data.id !== expected.id_externo)
      || (expected.estado_proveedor === "paid" && data.status !== "paid")
      || (expected.id_externo && (data.currency !== "GTQ" || data.total_in_cents !== expected.monto_centavos))
      || (data.live_mode !== undefined && data.live_mode !== false)
      || (data.sandbox_id !== undefined && data.sandbox_id !== config.sandboxId)
      || (data.currency !== undefined && data.currency !== "GTQ")
      || (data.total_in_cents !== undefined && data.total_in_cents !== expected.monto_centavos)) {
      throw new CheckoutError("CHECKOUT_INVALID_RESPONSE", { uncertain: true, checkout: allowed });
    }
    return allowed;
  }
  return {
    sandboxId: () => configuration().sandboxId,
    async createCheckout(local, beforeRequest) {
      const config = configuration();
      await sandbox(config); // A TEST prefix alone also permits legacy_test: do not infer the tenant.
      const returnUrl = `${config.origin}/${local.rol==='inquilino'?'inquilino':'residente'}/pagos/retorno?referencia=${encodeURIComponent(local.referencia_local)}`;
      const body = {
        items: [{ name: `NexusResidencial - ${String(local.concepto).replace(/[\r\n\t]/g, " ").slice(0, 120)}`,
          amount_in_cents: local.monto_centavos, currency: "GTQ", quantity: 1 }],
        metadata: { nexus_checkout_reference: local.referencia_local }, success_url: returnUrl, cancel_url: returnUrl,
      };
      await beforeRequest(); // Persist INCIERTO before a potentially irreversible external POST.
      const data = await request(config, "/checkouts", { method: "POST", body, uncertain: true });
      return checkout(data, local, config);
    },
    async getCheckout(local) {
      const config = configuration();
      await sandbox(config);
      const data = await request(config, `/checkouts/${encodeURIComponent(local.id_externo)}`, { uncertain: true });
      return checkout(data, local, config);
    },
  };
}
module.exports = { createRecurrenteClient };
