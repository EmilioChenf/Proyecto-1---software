import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { downloadReport } from "./reportExportService";

describe("HU10 descarga de reportes", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.setItem("nexus.session", JSON.stringify({ id: 7, role: "admin", token: "signed-token" }));
    vi.stubGlobal("fetch", vi.fn());
    vi.stubGlobal("URL", class extends URL {
      static createObjectURL = vi.fn(() => "blob:reporte");
      static revokeObjectURL = vi.fn();
    });
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); localStorage.clear(); });

  it("envía todos los filtros y respeta el nombre de archivo del servidor", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response("%PDF-test", { headers: { "Content-Type": "application/pdf", "Content-Disposition": 'attachment; filename="nexus-accesos-2026-09-07.pdf"' } }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.download).toBe("nexus-accesos-2026-09-07.pdf");
      expect(document.body.contains(this)).toBe(true);
    });
    await downloadReport({ reporte: "accesos", formato: "pdf", desde: "2026-09-01", hasta: "2026-09-07", type: "PROVEEDOR", status: "PENDIENTE", house: "A-1", search: "Ana", plate: "P123" });
    const [url, options] = vi.mocked(fetch).mock.calls[0];
    const query = new URL(String(url)).searchParams;
    expect(query.get("desde")).toBe("2026-09-01");
    expect(query.get("hasta")).toBe("2026-09-07");
    expect(query.get("type")).toBe("PROVEEDOR");
    expect(query.get("status")).toBe("PENDIENTE");
    expect(query.get("house")).toBe("A-1");
    expect(query.get("search")).toBe("Ana");
    expect(query.get("plate")).toBe("P123");
    expect(new Headers(options?.headers).get('Authorization')).toBe('Bearer signed-token');
    expect(click).toHaveBeenCalledOnce();
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:reporte");
  });

  it("muestra errores del servidor sin descargar un archivo", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ message: "Rango inválido" }), { status: 400 }));
    await expect(downloadReport({ reporte: "reservas", formato: "pdf" })).rejects.toThrow("Rango inválido");
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it("rechaza HTML y archivos vacíos", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response("<html>Error</html>", { headers: { "Content-Type": "text/html" } }));
    await expect(downloadReport({ reporte: "accesos", formato: "pdf" })).rejects.toThrow("formato incorrecto");
    vi.mocked(fetch).mockResolvedValueOnce(new Response("", { headers: { "Content-Type": "application/pdf" } }));
    await expect(downloadReport({ reporte: "accesos", formato: "pdf" })).rejects.toThrow("vacío");
  });

  it('HU29 avisa la sesión expirada y no descarga contenido de error', async () => {
    const expired = vi.fn(); window.addEventListener('nexus:session-expired', expired);
    try {
      vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ message: 'Sesión vencida' }), { status: 401 }));
      await expect(downloadReport({ reporte: 'pagos', formato: 'pdf' })).rejects.toMatchObject({ status: 401 });
      expect(expired).toHaveBeenCalledOnce(); expect(URL.createObjectURL).not.toHaveBeenCalled();
    } finally { window.removeEventListener('nexus:session-expired', expired); }
  });

  it('HU29 libera el archivo temporal aunque falle el inicio de descarga', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('%PDF', { headers: { 'Content-Type': 'application/pdf' } }));
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => { throw new Error('Descarga bloqueada'); });
    await expect(downloadReport({ reporte: 'pagos', formato: 'pdf' })).rejects.toThrow('Descarga bloqueada');
    expect(document.querySelector('a[download]')).toBeNull();
    vi.runAllTimers(); expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:reporte');
  });

  it('HU29 sanea errores internos y distingue fallos de conexión', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ message: 'SELECT private FROM db' }), { status: 500 }));
    await expect(downloadReport({ reporte: 'pagos', formato: 'pdf' })).rejects.not.toThrow('SELECT private');
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(downloadReport({ reporte: 'pagos', formato: 'pdf' })).rejects.toMatchObject({ status: 0 });
  });
  it('HU29 cancelar impide la descarga aunque una respuesta tardía ignore el aborto', async () => {
    const controller = new AbortController();
    vi.mocked(fetch).mockImplementation(async () => {
      controller.abort();
      return new Response('%PDF', { headers: { 'Content-Type': 'application/pdf' } });
    });
    await expect(downloadReport({ reporte: 'pagos', formato: 'pdf' }, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });
});
