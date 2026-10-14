import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { FinancialCharts } from './FinancialCharts';
import type { FinancialDashboard } from '@/services/financialDashboardService';
vi.mock('recharts', () => ({ ResponsiveContainer: () => <div>Gráfica</div>, BarChart: () => null, Bar: () => null,
  CartesianGrid: () => null, XAxis: () => null, YAxis: () => null, Tooltip: () => null, Legend: () => null }));
it('HU28 ofrece la información de la gráfica como tabla accesible con valores exactos y netos negativos', async () => {
  const user = userEvent.setup();
  render(<FinancialCharts data={{ conceptos: [], serie: [
    { fecha: '2026-10-01', cobrado: 0.1, devuelto: 0.3, neto: -0.2 },
    { fecha: '2026-10-02', cobrado: 0, devuelto: 0, neto: 0 },
  ] } as FinancialDashboard} />);
  const summary = screen.getByText('Consultar valores por día');
  await user.tab(); expect(summary).toHaveFocus();
  // jsdom does not implement the browser's native Enter activation for summary.
  await user.click(summary);
  expect(screen.getByRole('table', { name: 'Movimientos diarios en quetzales' })).toBeVisible();
  const row = screen.getByRole('row', { name: /2026-10-01/ });
  expect(row).toHaveTextContent('0.10'); expect(row).toHaveTextContent('0.30'); expect(row).toHaveTextContent('-Q');
  expect(screen.getByRole('region', { name: 'Valores diarios desplazables' })).toHaveAttribute('tabindex', '0');
  expect(screen.getByRole('row', { name: /2026-10-02/ })).toHaveTextContent('0.00');
});
