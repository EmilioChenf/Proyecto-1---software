// HU-C02 (C02.4-C02.7): verificacion en navegador real de SweetAlert2 y de los errores
// dentro del modal de usuarios. Las respuestas de la API se simulan EN EL NAVEGADOR con
// CDP (Fetch.fulfillRequest): no se usa ningun backend ni datos reales.
//
// Uso (app servida con VITE_API_URL=http://127.0.0.1:9):
//   node scripts/ui-feedback-check.mjs --url http://127.0.0.1:5192 --out <carpeta>
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, index, all) => {
  if (value.startsWith("--")) pairs.push([value.slice(2), all[index + 1]]);
  return pairs;
}, []));
const baseUrl = String(args.url || "").replace(/\/$/, "");
const outDir = path.resolve(args.out || "ui-feedback-out");
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(baseUrl)) throw new Error("--url debe ser un servidor local.");
const browserPath = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "/usr/bin/google-chrome", "/usr/bin/chromium"].find((candidate) => existsSync(candidate));
if (!browserPath) throw new Error("No se encontro Edge/Chrome.");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const ana = { id_usuario: 7, nombre: "Ana <b>Lopez</b>", correo: "ana@ejemplo.com", telefono: null, id_tipo_usuario: 1, rol: "admin", unidad: null, id_casa: null, numero_casa: null, torre: null };

// Escenario de la API simulada; cada paso del script lo ajusta.
const api = { deleteStatus: 409, createStatus: 409 };
function respond(method, url) {
  const { pathname } = new URL(url);
  if (method === "GET" && pathname === "/usuarios") return [200, [ana]];
  if (method === "GET" && pathname === "/tipos-usuario") return [200, [{ id: 1, nombre: "admin" }]];
  if (method === "DELETE" && pathname === "/usuarios/7") {
    return api.deleteStatus === 200 ? [200, { message: "ok" }] : [409, { message: "No se puede eliminar un usuario con historial de accesos." }];
  }
  if (method === "POST" && pathname === "/usuarios") {
    return api.createStatus === 201 ? [201, { ...ana, id_usuario: 8, nombre: "Luis" }] : [409, { message: "Ya existe un usuario con ese correo." }];
  }
  if (method === "GET" && pathname === "/auth/session") return [200, { id: 1, email: "admin@demo.local", role: "admin" }];
  return [200, []];
}

async function main() {
  mkdirSync(outDir, { recursive: true });
  const profile = mkdtempSync(path.join(tmpdir(), "nexus-ui-feedback-"));
  const port = 9800 + Math.floor(Math.random() * 150);
  const child = spawn(browserPath, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    "--no-first-run", "--no-default-browser-check", "--disable-extensions", "about:blank"], { stdio: "ignore" });
  const checks = [];
  try {
    for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) break; } catch { /* arrancando */ } await sleep(250); }
    const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })).json();
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
    let id = 0;
    const pending = new Map();
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const messageId = ++id; pending.set(messageId, { resolve, reject });
      socket.send(JSON.stringify({ id: messageId, method, params }));
    });
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id && pending.has(message.id)) {
        const { resolve, reject } = pending.get(message.id); pending.delete(message.id);
        return message.error ? reject(new Error(message.error.message)) : resolve(message.result);
      }
      if (message.method === "Fetch.requestPaused") {
        const { requestId, request } = message.params;
        if (request.method === "OPTIONS") {
          void send("Fetch.fulfillRequest", { requestId, responseCode: 204, responseHeaders: corsHeaders() });
          return;
        }
        const [status, body] = respond(request.method, request.url);
        void send("Fetch.fulfillRequest", { requestId, responseCode: status, responseHeaders: [...corsHeaders(), { name: "Content-Type", value: "application/json" }],
          body: Buffer.from(JSON.stringify(body)).toString("base64") });
      }
    });
    const corsHeaders = () => [{ name: "Access-Control-Allow-Origin", value: baseUrl }, { name: "Access-Control-Allow-Credentials", value: "true" },
      { name: "Access-Control-Allow-Headers", value: "Content-Type, Authorization" }, { name: "Access-Control-Allow-Methods", value: "GET,POST,PUT,PATCH,DELETE,OPTIONS" }];
    const evaluate = async (expression) => (await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result.value;
    const shot = async (name) => {
      const image = await send("Page.captureScreenshot", { format: "png" });
      writeFileSync(path.join(outDir, name), Buffer.from(image.data, "base64"));
      return name;
    };
    const waitFor = async (expression, timeout = 15000) => {
      const started = Date.now();
      while (Date.now() - started < timeout) { if (await evaluate(expression)) return true; await sleep(150); }
      return false;
    };
    const check = (name, ok, detail = {}) => { checks.push({ name, ok: Boolean(ok), ...detail }); };

    await send("Page.enable");
    await send("Runtime.enable");
    await send("Fetch.enable", { patterns: [{ urlPattern: "http://127.0.0.1:9/*" }] });
    await send("Page.navigate", { url: `${baseUrl}/` });
    await sleep(800);
    await evaluate(`localStorage.setItem("nexus.session", JSON.stringify({ id: 1, email: "admin@demo.local", role: "admin", token: "sin-backend" })); true`);

    for (const viewport of [{ name: "desktop", width: 1440, height: 900 }, { name: "movil", width: 375, height: 812 }]) {
      await send("Emulation.setDeviceMetricsOverride", { width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: false });
      api.deleteStatus = 409; api.createStatus = 409;
      await send("Page.navigate", { url: `${baseUrl}/admin/usuarios` });
      await waitFor(`[...document.querySelectorAll("button")].some((b) => b.textContent.trim() === "Eliminar")`);
      await sleep(600);

      // 1. Confirmacion destructiva: foco en Cancelar y nombre con HTML mostrado como texto.
      await evaluate(`[...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Eliminar").click(); true`);
      await waitFor(`!!document.querySelector(".swal2-popup.swal2-show")`);
      await sleep(400);
      const confirmState = await evaluate(`({ title: document.querySelector(".swal2-title")?.textContent, boldInjected: !!document.querySelector(".swal2-title b"),
        focused: document.activeElement?.className, bodyHeight: document.body.style.height, htmlHeight: document.documentElement.style.height })`);
      check(`${viewport.name}: confirmacion con foco en Cancelar`, String(confirmState.focused).includes("swal2-cancel"), confirmState);
      check(`${viewport.name}: datos del usuario como texto (sin HTML)`, confirmState.title === "¿Eliminar a Ana <b>Lopez</b>?" && !confirmState.boldInjected);
      check(`${viewport.name}: heightAuto desactivado (no altera body/html)`, !confirmState.bodyHeight && !confirmState.htmlHeight);
      const confirmShot = await shot(`swal-${viewport.name}-1-confirmacion.png`);

      // 2. Error del servidor tras confirmar (409 simulado).
      await evaluate(`document.querySelector(".swal2-confirm").click(); true`);
      await waitFor(`!!document.querySelector(".swal2-icon.swal2-error.swal2-icon-show")`);
      await sleep(500);
      const errorText = await evaluate(`document.querySelector(".swal2-html-container")?.textContent`);
      check(`${viewport.name}: error del servidor en SweetAlert2`, errorText === "No se puede eliminar un usuario con historial de accesos.", { errorText });
      const pageDuplicates = await evaluate(`document.body.innerText.split("No se puede eliminar un usuario con historial de accesos.").length - 1`);
      check(`${viewport.name}: el error no se duplica en la pagina`, pageDuplicates === 1, { apariciones: pageDuplicates });
      const errorShot = await shot(`swal-${viewport.name}-2-error-servidor.png`);
      await evaluate(`document.querySelector(".swal2-confirm").click(); true`);
      await waitFor(`!document.querySelector(".swal2-container")`);

      // 3. Exito: confirmar con DELETE 200 muestra un toast.
      api.deleteStatus = 200;
      await evaluate(`[...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Eliminar").click(); true`);
      await waitFor(`!!document.querySelector(".swal2-confirm")`);
      await sleep(300);
      await evaluate(`document.querySelector(".swal2-confirm").click(); true`);
      await waitFor(`!!document.querySelector(".swal2-toast .swal2-icon.swal2-success")`);
      await sleep(500);
      const toastTitle = await evaluate(`document.querySelector(".swal2-toast .swal2-title")?.textContent`);
      check(`${viewport.name}: exito como toast`, toastTitle === "Usuario eliminado correctamente.", { toastTitle });
      const successShot = await shot(`swal-${viewport.name}-3-exito-toast.png`);
      await evaluate(`window.Swal?.close?.(); document.querySelector(".swal2-container")?.remove(); true`);

      // 4. Errores dentro del modal: envio vacio y correo duplicado (409).
      await evaluate(`[...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Crear usuario").click(); true`);
      await waitFor(`!!document.querySelector('[role="dialog"]')`);
      await evaluate(`[...document.querySelectorAll('[role="dialog"] button[type="submit"]')][0].click(); true`);
      await sleep(400);
      const emptyState = await evaluate(`({ invalid: [...document.querySelectorAll('[role="dialog"] [aria-invalid="true"]')].map((e) => e.id),
        focused: document.activeElement?.id, border: getComputedStyle(document.getElementById("user-name")).borderColor,
        swalOpen: !!document.querySelector(".swal2-container") })`);
      check(`${viewport.name}: campos invalidos marcados en el modal`, emptyState.invalid.length >= 4 && emptyState.focused === "user-name" && !emptyState.swalOpen, emptyState);
      const emptyShot = await shot(`modal-${viewport.name}-4-campos-invalidos.png`);

      const type = (fieldId, value) => `(() => { const el = document.getElementById("${fieldId}");
        const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value").set; setter.call(el, ${JSON.stringify(value)});
        el.dispatchEvent(new Event("${fieldId === "user-role" ? "change" : "input"}", { bubbles: true })); return true; })()`;
      await evaluate(type("user-name", "Luis"));
      await evaluate(type("user-email", "ana@ejemplo.com"));
      await evaluate(type("user-password", "clave123"));
      await evaluate(type("user-role", "1"));
      await sleep(200);
      await evaluate(`[...document.querySelectorAll('[role="dialog"] button[type="submit"]')][0].click(); true`);
      await waitFor(`document.getElementById("user-email")?.getAttribute("aria-invalid") === "true"`);
      await sleep(400);
      const duplicateState = await evaluate(`({ message: document.getElementById("user-email-error")?.textContent, focused: document.activeElement?.id,
        swalOpen: !!document.querySelector(".swal2-container"), alerts: document.querySelectorAll('[role="dialog"] [role="alert"]').length })`);
      check(`${viewport.name}: correo duplicado junto al campo, sin SweetAlert2`, duplicateState.message === "Ya existe un usuario con ese correo."
        && duplicateState.focused === "user-email" && !duplicateState.swalOpen && duplicateState.alerts === 0, duplicateState);
      const duplicateShot = await shot(`modal-${viewport.name}-5-correo-duplicado.png`);
      checks.at(-1).screenshots = [confirmShot, errorShot, successShot, emptyShot, duplicateShot];
    }
    socket.close();
  } finally {
    child.kill();
    await sleep(500);
    try { rmSync(profile, { recursive: true, force: true }); } catch { /* perfil en uso */ }
  }
  const failed = checks.filter((item) => !item.ok);
  writeFileSync(path.join(outDir, "swal-resultados.json"), `${JSON.stringify({ baseUrl, browser: path.basename(browserPath), checkedAt: new Date().toISOString(), checks }, null, 2)}\n`);
  for (const item of checks) console.log(`${item.ok ? "ok   " : "FALLA"} ${item.name}`);
  console.log(JSON.stringify({ checks: checks.length, failed: failed.length }));
  process.exitCode = failed.length ? 1 : 0;
}

main().catch((error) => { console.error(error.message); process.exitCode = 2; });
