// HU-C02: verificacion en navegador real (Edge/Chrome headless via CDP) de los
// controles de navegacion del sidebar en varios anchos y niveles de zoom.
// jsdom no aplica la cascada de capas CSS, por eso esta comprobacion usa un navegador.
//
// Uso (con la app servida, p. ej. `npx vite --port 5192`):
//   node scripts/ui-responsive-check.mjs --url http://127.0.0.1:5192 --out <carpeta> [--label antes|despues]
//
// No necesita backend: la sesion se simula en localStorage solo para renderizar el
// layout (las llamadas a la API fallan y la app conserva la sesion local).
// Sin dependencias: usa el WebSocket nativo de Node >= 22.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, index, all) => {
  if (value.startsWith("--")) pairs.push([value.slice(2), all[index + 1]]);
  return pairs;
}, []));
const baseUrl = String(args.url || "").replace(/\/$/, "");
const outDir = path.resolve(args.out || "ui-responsive-out");
const label = args.label || "resultado";
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(baseUrl)) throw new Error("--url debe ser un servidor local.");

const BROWSERS = [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
];
const browserPath = args.browser || BROWSERS.find((candidate) => existsSync(candidate));
if (!browserPath) throw new Error("No se encontro Edge/Chrome.");

// Ancho fisico de la ventana y zoom del navegador: el ancho CSS efectivo es ancho/zoom.
const VIEWPORTS = [
  { name: "movil-375", width: 375, height: 812, zoom: 1 },
  { name: "tablet-768", width: 768, height: 1024, zoom: 1 },
  { name: "laptop-1024", width: 1024, height: 768, zoom: 1 },
  { name: "desktop-1440", width: 1440, height: 900, zoom: 1 },
  { name: "desktop-1920", width: 1920, height: 1080, zoom: 1 },
  { name: "desktop-1440-zoom125", width: 1440, height: 900, zoom: 1.25 },
  { name: "desktop-1440-zoom150", width: 1440, height: 900, zoom: 1.5 },
  { name: "desktop-1920-zoom200", width: 1920, height: 1080, zoom: 2 },
];
const ROLES = [
  { role: "admin", path: "/admin" },
  { role: "residente", path: "/residente" },
  { role: "inquilino", path: "/inquilino" },
  { role: "guardia", path: "/guardia" },
];
const CONTROL_LABELS = ["Abrir menú", "Cerrar menú", "Contraer menú lateral", "Expandir menú lateral"];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function launch() {
  const profile = mkdtempSync(path.join(tmpdir(), "nexus-ui-check-"));
  const port = 9300 + Math.floor(Math.random() * 500);
  const child = spawn(browserPath, [
    "--headless=new", ...(process.getuid?.() === 0 ? ["--no-sandbox"] : []), `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    "--no-first-run", "--no-default-browser-check", "--disable-extensions", "about:blank",
  ], { stdio: "ignore" });
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) return { child, profile, port };
    } catch { /* aun arrancando */ }
    await sleep(250);
  }
  child.kill();
  throw new Error("El navegador no expuso CDP.");
}

function connect(wsUrl) {
  const socket = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  const events = [];
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
    } else if (message.method) events.push(message.method);
  });
  const ready = new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const messageId = ++id;
    pending.set(messageId, { resolve, reject });
    socket.send(JSON.stringify({ id: messageId, method, params }));
  });
  return { ready, send, close: () => socket.close(), events };
}

const COUNT_CONTROLS = `(() => {
  const labels = ${JSON.stringify(CONTROL_LABELS)};
  return [...document.querySelectorAll("button[aria-label]")]
    .filter((button) => labels.includes(button.getAttribute("aria-label")))
    .map((button) => {
      const rect = button.getBoundingClientRect();
      const visible = button.checkVisibility({ checkOpacity: true, visibilityProperty: true })
        && rect.width > 0 && rect.height > 0
        && rect.right > 0 && rect.bottom > 0 && rect.left < innerWidth && rect.top < innerHeight;
      return { label: button.getAttribute("aria-label"), visible, x: Math.round(rect.x), y: Math.round(rect.y) };
    });
})()`;

const WAIT_RENDERED = `new Promise((resolve) => {
  const started = Date.now();
  const check = () => {
    if (document.querySelector("aside.nd-side")) return resolve(true);
    if (Date.now() - started > 20000) return resolve(false);
    setTimeout(check, 200);
  };
  check();
})`;

async function evaluate(page, expression) {
  const result = await page.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  return result.result.value;
}

async function main() {
  mkdirSync(outDir, { recursive: true });
  const { child, profile, port } = await launch();
  const results = [];
  try {
    const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })).json();
    const page = connect(target.webSocketDebuggerUrl);
    await page.ready;
    await page.send("Page.enable");
    await page.send("Runtime.enable");

    for (const { role, path: rolePath } of ROLES) {
      await page.send("Page.navigate", { url: `${baseUrl}/` });
      await sleep(800);
      await evaluate(page, `localStorage.setItem("nexus.session", JSON.stringify({ id: 1, email: "${role}@demo.local", role: "${role}", token: "sin-backend" })); true`);

      for (const viewport of VIEWPORTS) {
        const cssWidth = Math.round(viewport.width / viewport.zoom);
        const cssHeight = Math.round(viewport.height / viewport.zoom);
        await page.send("Emulation.setDeviceMetricsOverride", {
          width: cssWidth, height: cssHeight, deviceScaleFactor: viewport.zoom, mobile: false,
        });
        await page.send("Page.navigate", { url: `${baseUrl}${rolePath}` });
        await sleep(300);
        const rendered = await evaluate(page, WAIT_RENDERED);
        await sleep(700); // termina la animacion de entrada antes de medir/capturar
        const closed = await evaluate(page, COUNT_CONTROLS);
        const shot = `${label}-${role}-${viewport.name}.png`;
        const image = await page.send("Page.captureScreenshot", { format: "png" });
        writeFileSync(path.join(outDir, shot), Buffer.from(image.data, "base64"));

        // En modo movil se abre el menu y se vuelven a contar los controles visibles.
        let opened = null;
        let openShot = null;
        const menuVisible = closed.some((control) => control.label === "Abrir menú" && control.visible);
        if (menuVisible) {
          await evaluate(page, `document.querySelector('button[aria-label="Abrir menú"]').click(); true`);
          await sleep(500);
          opened = await evaluate(page, COUNT_CONTROLS);
          openShot = `${label}-${role}-${viewport.name}-menu-abierto.png`;
          const openImage = await page.send("Page.captureScreenshot", { format: "png" });
          writeFileSync(path.join(outDir, openShot), Buffer.from(openImage.data, "base64"));
        }
        const visibleClosed = closed.filter((control) => control.visible).map((control) => control.label);
        const visibleOpen = opened ? opened.filter((control) => control.visible).map((control) => control.label) : null;
        results.push({
          role, viewport: viewport.name, cssWidth, zoom: viewport.zoom, rendered,
          visibleControlsClosed: visibleClosed,
          visibleControlsMenuOpen: visibleOpen,
          duplicated: rendered && (visibleClosed.length !== 1 || (visibleOpen !== null && visibleOpen.length !== 1)),
          screenshots: [shot, openShot].filter(Boolean),
        });
      }
    }
    page.close();
  } finally {
    child.kill();
    await sleep(500);
    try { rmSync(profile, { recursive: true, force: true }); } catch { /* perfil temporal en uso */ }
  }

  const summary = { label, baseUrl, browser: path.basename(browserPath), checkedAt: new Date().toISOString(),
    cases: results.length, duplicatedCases: results.filter((item) => item.duplicated).length,
    notRenderedCases: results.filter((item) => !item.rendered).length, results };
  writeFileSync(path.join(outDir, `${label}-resultados.json`), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify({ label, cases: summary.cases, duplicatedCases: summary.duplicatedCases, notRenderedCases: summary.notRenderedCases }));
  for (const item of results) {
    console.log(`${!item.rendered ? "NO-RENDER" : item.duplicated ? "DUPLICADO" : "ok       "} ${item.role.padEnd(9)} ${item.viewport.padEnd(22)} css=${String(item.cssWidth).padEnd(4)} cerrado=[${item.visibleControlsClosed.join(", ")}]${item.visibleControlsMenuOpen ? ` abierto=[${item.visibleControlsMenuOpen.join(", ")}]` : ""}`);
  }
  process.exitCode = summary.duplicatedCases || summary.notRenderedCases ? 1 : 0;
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 2;
});
