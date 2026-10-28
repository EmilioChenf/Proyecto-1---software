// Browser verification against the real frontend with an explicitly simulated API.
// Start frontend with npm run dev, then set NEXUS_PLAYWRIGHT_MODULE if necessary.
const { chromium } = require(process.env.NEXUS_PLAYWRIGHT_MODULE || "playwright");
const fs = require("node:fs/promises");
const path = require("node:path");
const assert = require("node:assert/strict");
const output = path.join(__dirname, "evidence");
const origin = process.env.NEXUS_UI_ORIGIN || "http://127.0.0.1:5173";
const results = [];

async function main() {
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ headless: true, executablePath: process.env.NEXUS_CHROMIUM || undefined });
  try {
    for (const role of ["admin", "residente", "inquilino", "guardia"]) {
      for (const width of [1440, 375]) {
        const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: "reduce" });
        const user = { id: 7, role, email: `${role}@test.invalid`, token: "browser-fixture" };
        await context.addInitScript((session) => localStorage.setItem("nexus.session", JSON.stringify(session)), user);
        let fail = false;
        await context.route("http://localhost:3000/**", async (route) => {
          const request = route.request();
          const pathname = new URL(request.url()).pathname;
          let body = [], status = 200;
          if (pathname === "/auth/session") body = user;
          else if (pathname === "/auth/sessions") body = [{ id_sesion: "other", dispositivo: "Dispositivo de prueba", direccion_ip: "127.0.0.1", ultima_actividad_en: "2026-10-27 18:00:00", actual: false }];
          else if (pathname === "/auth/sessions/other") { status = fail ? 409 : 200; body = fail ? { message: "No fue posible cerrar esta sesión. Intenta nuevamente." } : { id_sesion: "other", actual: false, cerrada: true }; }
          else if (pathname === "/inquilino/reservas/amenidades") body = [{ reservation_key: "7-2-2026-10-28-10:00", id_usuario: 7, id_amenidad: 2, amenidad_nombre: "Piscina", fecha: "2026-10-28", hora_inicio: "10:00", hora_fin: "11:00", estado: "CANCELADA", estado_actual: "CANCELADA", creada_por_admin: true, creada_por_nombre: "Admin A", cancelada_por_nombre: "Admin B", cancelada_en: "2026-10-27 18:00:00", motivo_cancelacion: "Mantenimiento preventivo" }];
          else if (pathname === "/inquilino/reservas/amenidades/historial") body = [{ id_historial: 1, detalle: "Admin B canceló la reserva de Piscina. Motivo: Mantenimiento preventivo", creado_en: "2026-10-27 18:00:00" }];
          else if (pathname.includes("no-leidas")) body = { total: 0 };
          else if (pathname.includes("estado-cuenta")) body = { cuotas: [], casa: { unidad: "B-302" } };
          await route.fulfill({ status: request.method() === "OPTIONS" ? 204 : status, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type, Authorization", "Access-Control-Allow-Methods": "GET, DELETE, OPTIONS" }, body: request.method() === "OPTIONS" ? "" : JSON.stringify(body) });
        });
        const page = await context.newPage();
        const errors = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.goto(`${origin}/cuenta/sesiones`);
        await page.getByRole("button", { name: "Cerrar sesion", exact: true }).click();
        const tray = page.getByRole("region", { name: "Notificaciones de acciones" });
        await tray.getByText("Sesión cerrada correctamente.", { exact: true }).waitFor();
        const box = await tray.boundingBox();
        assert(box && box.x >= 0 && box.x + box.width <= width, "Tray fits the viewport");
        await page.screenshot({ path: path.join(output, `${role}-${width}-success.png`), fullPage: true });
        await tray.getByRole("button", { name: "Cerrar notificación" }).focus();
        await page.keyboard.press("Enter");
        assert.equal(await tray.getByRole("status").count(), 0);
        fail = true;
        await page.reload();
        await page.getByRole("button", { name: "Cerrar sesion", exact: true }).click();
        await tray.getByRole("alert").waitFor();
        await page.screenshot({ path: path.join(output, `${role}-${width}-error.png`), fullPage: true });
        if (role === "inquilino") {
          await tray.getByRole("button", { name: "Cerrar notificación" }).click();
          await page.goto(`${origin}/inquilino/reservas`);
          await page.getByText(/Cancelada por Admin B/).waitFor();
          await page.screenshot({ path: path.join(output, `${role}-${width}-reservations.png`), fullPage: true });
        }
        assert.equal(errors.length, 0, errors.join("\n"));
        results.push({ role, width, successToast: true, errorToast: true, keyboardDismiss: true, fitsViewport: true, pageErrors: errors });
        await context.close();
      }
    }
  } finally { await browser.close(); }
  await fs.writeFile(path.join(output, "ui-results.json"), JSON.stringify({ api: "simulated", origin, results }, null, 2));
  console.log(JSON.stringify({ passed: results.length, api: "simulated", screenshots: results.length * 2 + 2 }));
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
