import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, it, expect, beforeEach } from 'vitest';
import { AdminFinancialDashboardView } from './AdminFinancialDashboardView';
import { getFinancialDashboard } from '@/services/financialDashboardService';
vi.mock('@/services/financialDashboardService', async original => ({ ...await original<object>(), getFinancialDashboard: vi.fn() }));
vi.mock('@/components/admin/AdminLayout', () => ({ AdminLayout: ({ children }: any) => <main>{children}</main> }));
export const dashboardFixture = {
  fecha_corte: '2026-10-14', periodo: { desde: '2026-10-01', hasta: '2026-10-14' },
  movimientos: { cobrado: 100, devuelto: 120, neto: -20, cantidad_pagos: 2 }, recargos: { registrado: 5, cantidad: 1 },
  saldos: { pendiente: 80, capital_pendiente: 75, recargo_pendiente: 5, mora: 40, cuotas_pendientes: 2, cuotas_morosas: 1,
    responsables_morosos: 1, cuotas_sin_responsable: 0, sobrepago: 0, reembolso_inconsistente: 0 }, conceptos: [], serie: [],
};
beforeEach(() => { vi.mocked(getFinancialDashboard).mockReset().mockResolvedValue(dashboardFixture); });
it('HU28 presenta movimientos separados de saldos y permite consultar un rango', async () => {
  render(<AdminFinancialDashboardView />);
  expect(await screen.findByText('Ingreso neto')).toBeInTheDocument();
  expect(screen.getByRole('region', { name: 'Saldos actuales' })).toHaveTextContent('solo cambia los movimientos');
  fireEvent.change(screen.getByLabelText('Desde'), { target: { value: '2026-09-01' } });
  fireEvent.change(screen.getByLabelText('Hasta'), { target: { value: '2026-09-30' } });
  fireEvent.click(screen.getByRole('button', { name: 'Consultar' }));
  await waitFor(() => expect(getFinancialDashboard).toHaveBeenLastCalledWith('2026-09-01', '2026-09-30', expect.any(AbortSignal)));
});
it('HU28 informa fallos sin mostrar cifras inventadas', async () => {
  vi.mocked(getFinancialDashboard).mockRejectedValue(new Error('Servicio temporalmente no disponible'));
  render(<AdminFinancialDashboardView />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Servicio temporalmente no disponible');
  expect(screen.queryByText('Ingreso neto')).not.toBeInTheDocument();
});
