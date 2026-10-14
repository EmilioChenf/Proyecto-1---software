import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AdminReportsView } from "./AdminReportsView";
import { downloadReport } from "@/services/reportExportService";
import { getReportCatalog } from '@/services/reportCatalogService';
vi.mock('@/services/reportCatalogService', () => ({ getReportCatalog: vi.fn() }));
beforeEach(() => { vi.mocked(getReportCatalog).mockResolvedValue([
  { id: 'accesos', title: 'Accesos', filters: [], formats: ['pdf', 'xlsx'], columns: [], maxRows: 10000, usesDates: true },
  { id: 'reservas', title: 'Reservas', filters: [{ key: 'estado', label: 'Estado de reserva', options: ['CONFIRMADA'] }], formats: ['pdf', 'xlsx'], columns: [], maxRows: 10000, usesDates: true },
  { id: 'pagos', title: 'Pagos aplicados', filters: [{ key: 'responsable', label: 'Responsable histórico' }], formats: ['pdf', 'xlsx'], columns: [], maxRows: 10000, usesDates: true },
  { id: 'morosos', title: 'Morosos', filters: [], formats: ['pdf', 'xlsx'], columns: [], maxRows: 10000, usesDates: false },
]); });
vi.mock("@/components/admin/AdminLayout", () => ({ AdminLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("@/services/reportExportService", () => ({ downloadReport: vi.fn() }));
afterEach(() => vi.resetAllMocks());

it("HU10 exporta el reporte, formato y período elegidos", async () => {
  vi.mocked(downloadReport).mockResolvedValue();
  render(<AdminReportsView />);
  await screen.findByRole('option', { name: 'Reservas' });
  fireEvent.change(screen.getByLabelText("Reporte"), { target: { value: "reservas" } });
  fireEvent.change(screen.getByLabelText("Formato"), { target: { value: "xlsx" } });
  fireEvent.change(screen.getByLabelText("Desde"), { target: { value: "2026-09-01" } });
  fireEvent.change(screen.getByLabelText("Hasta"), { target: { value: "2026-09-07" } });
  fireEvent.click(screen.getByRole("button", { name: "Exportar" }));
  await waitFor(() => expect(downloadReport).toHaveBeenCalledWith({ reporte: "reservas", formato: "xlsx", desde: "2026-09-01", hasta: "2026-09-07" }));
});

it("HU10 muestra errores de exportación y permite reintentar", async () => {
  vi.mocked(downloadReport).mockRejectedValue(new Error("Reduzca el período"));
  render(<AdminReportsView />);
  await screen.findByRole('option', { name: 'Accesos' });
  fireEvent.click(screen.getByRole("button", { name: "Exportar" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Reduzca el período");
  expect(screen.getByRole("button", { name: "Exportar" })).toBeEnabled();
});

it('HU29 descarga con filtros de módulo y los limpia al cambiar de reporte', async () => {
  vi.mocked(downloadReport).mockResolvedValue();
  render(<AdminReportsView />);
  await screen.findByRole('option', { name: 'Reservas' });
  fireEvent.change(screen.getByLabelText('Reporte'), { target: { value: 'reservas' } });
  fireEvent.change(screen.getByLabelText('Estado de reserva'), { target: { value: 'CONFIRMADA' } });
  fireEvent.click(screen.getByRole('button', { name: 'Exportar' }));
  await waitFor(() => expect(downloadReport).toHaveBeenCalledWith(expect.objectContaining({ estado: 'CONFIRMADA' })));
  await waitFor(() => expect(screen.getByLabelText('Reporte')).toBeEnabled());
  fireEvent.change(screen.getByLabelText('Reporte'), { target: { value: 'pagos' } });
  fireEvent.change(screen.getByLabelText('Responsable histórico'), { target: { value: 'Ana' } });
  fireEvent.click(screen.getByRole('button', { name: 'Exportar' }));
  await waitFor(() => expect(downloadReport).toHaveBeenLastCalledWith({ reporte: 'pagos', formato: 'pdf', desde: '', hasta: '', responsable: 'Ana' }));
});
