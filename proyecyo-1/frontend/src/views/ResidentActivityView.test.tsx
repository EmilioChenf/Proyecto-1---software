import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { ResidentActivityView } from './ResidentActivityView';
import { getResidentActivity } from '@/services/residentActivityService';
vi.mock('@/components/residente/ResidentLayout', () => ({ ResidentLayout: ({ children }: any) => <main>{children}</main> }));
vi.mock('@/services/residentActivityService', async original => ({ ...await original<object>(), getResidentActivity: vi.fn() }));
beforeEach(() => { vi.mocked(getResidentActivity).mockReset().mockResolvedValue({ items: [], page: 1, limit: 20, hasMore: false }); });
it('HU30 muestra estado vacío y envía filtros sin identidad de usuario', async () => {
  render(<ResidentActivityView />);
  expect(await screen.findByText('No hay actividad para estos filtros.')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Tipo de actividad'), { target: { value: 'pago' } });
  fireEvent.change(screen.getByLabelText('Desde'), { target: { value: '2026-10-01' } });
  fireEvent.click(screen.getByRole('button', { name: 'Filtrar' }));
  await waitFor(() => expect(getResidentActivity).toHaveBeenLastCalledWith({ tipo: 'pago', desde: '2026-10-01', hasta: '' }, 1, expect.any(AbortSignal)));
});
it('HU30 permite leer detalles y avanzar a otra página', async () => {
  vi.mocked(getResidentActivity).mockResolvedValueOnce({ page: 1, limit: 20, hasMore: true, items: [
    { id: 'pago:5', tipo: 'pago', fecha: null, hora: null, titulo: 'Mantenimiento', estado: 'APLICADO', monto: 50, detalle: 'Pago #5 · Cuota #2' },
  ] }).mockResolvedValueOnce({ page: 2, limit: 20, hasMore: false, items: [] });
  render(<ResidentActivityView />);
  expect(await screen.findByText('Fecha no registrada')).toBeInTheDocument();
  fireEvent.click(screen.getByText('Detalle de pago'));
  expect(screen.getByText('Pago #5 · Cuota #2')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }));
  expect(await screen.findByText('Página 2')).toBeInTheDocument();
});
it('HU30 informa errores de consulta', async () => {
  vi.mocked(getResidentActivity).mockRejectedValue(new Error('Sesión expirada'));
  render(<ResidentActivityView />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Sesión expirada');
});
