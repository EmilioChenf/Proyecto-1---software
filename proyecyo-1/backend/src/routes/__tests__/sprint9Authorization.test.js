jest.mock('../../config/env', () => ({ env: { NODE_ENV: 'production', SESSION_SECRET: 'sprint9-test-only-secret' } }));
jest.mock('../../services/authService', () => ({ getCurrentSession: jest.fn() }));
jest.mock('../../services/activeSessionsService', () => ({ assertActiveSession: jest.fn() }));
jest.mock('../../services/financialDashboardService', () => ({ summary: jest.fn() }));
jest.mock('../../services/residentActivityService', () => ({ list: jest.fn() }));
jest.mock('../../services/reportExportService', () => ({
  catalog: jest.fn(() => []), validate: jest.fn(() => ({ type: 'pagos', format: 'pdf' })), validateFilters: jest.fn(() => ({})),
  rows: jest.fn(async () => []), pdf: jest.fn(async () => Buffer.from('%PDF-test')), localTimestamp: jest.fn(() => '2026-10-14 12:00:00'),
}));
const request = require('supertest');
const express = require('express');
const { createSessionToken } = require('../../services/sessionTokenService');
const { getCurrentSession } = require('../../services/authService');
const { assertActiveSession } = require('../../services/activeSessionsService');
const dashboard = require('../../services/financialDashboardService');
const activity = require('../../services/residentActivityService');
const reports = require('../../services/reportExportService');
const app = express();
app.use(require('../financialDashboardRoutes'), require('../residentActivityRoutes'), require('../reportExportRoutes'));
app.use((error, _req, res, _next) => res.status(error.status || 500).json({ message: 'Solicitud rechazada' }));
beforeEach(() => {
  jest.clearAllMocks();
  getCurrentSession.mockReset().mockResolvedValue({ id: 7, role: 'admin' });
  assertActiveSession.mockReset().mockResolvedValue(undefined);
  dashboard.summary.mockResolvedValue({ saldos: {} });
  activity.list.mockResolvedValue({ items: [] });
});
const endpoints = ['/admin/finanzas/resumen', '/admin/reportes/catalogo', '/admin/reportes/exportar?reporte=pagos&formato=pdf', '/residente/actividad'];
test.each(endpoints)('HU28–HU30 %s no acepta cabeceras de identidad falsificadas en producción', async path => {
  await request(app).get(path).set('x-user-id', '7').set('x-user-role', path.startsWith('/admin') ? 'admin' : 'residente').expect(401);
  await request(app).get(path).set('Authorization', 'Bearer invalid').expect(401);
  expect(dashboard.summary).not.toHaveBeenCalled(); expect(activity.list).not.toHaveBeenCalled(); expect(reports.rows).not.toHaveBeenCalled();
});
test.each(endpoints)('HU28–HU30 %s rechaza una sesión revocada aunque su firma sea válida', async path => {
  assertActiveSession.mockRejectedValue(Object.assign(new Error('Revocada'), { status: 401 }));
  await request(app).get(path).set('Authorization', `Bearer ${createSessionToken(7, 'revoked')}`).expect(401);
  expect(getCurrentSession).not.toHaveBeenCalled();
});
test.each(['residente', 'inquilino', 'guardia'])('HU28/HU29 deniega el rol %s en todos los recursos administrativos', async role => {
  getCurrentSession.mockResolvedValue({ id: 7, role });
  for (const path of endpoints.filter(path => path.startsWith('/admin'))) {
    await request(app).get(path).set('Authorization', `Bearer ${createSessionToken(7)}`).expect(403);
  }
  expect(reports.rows).not.toHaveBeenCalled(); expect(dashboard.summary).not.toHaveBeenCalled();
});
test.each(['admin', 'inquilino', 'guardia'])('HU30 deniega el historial personal al rol %s', async role => {
  getCurrentSession.mockResolvedValue({ id: 7, role });
  await request(app).get('/residente/actividad').set('Authorization', `Bearer ${createSessionToken(7)}`).expect(403);
  expect(activity.list).not.toHaveBeenCalled();
});
test('HU30 obtiene identidad del servidor e impide caché compartida', async () => {
  getCurrentSession.mockResolvedValue({ id: 7, role: 'residente' });
  const response = await request(app).get('/residente/actividad').set('x-user-id', '99').set('Authorization', `Bearer ${createSessionToken(7, 'active')}`).expect(200);
  expect(activity.list).toHaveBeenCalledWith(7, {});
  expect(assertActiveSession).toHaveBeenCalledWith(7, 'active');
  expect(response.headers['cache-control']).toBe('no-store');
});
test('HU28/HU29 permiten sesión administrativa vigente y evitan caché', async () => {
  for (const path of endpoints.filter(path => path.startsWith('/admin'))) {
    const response = await request(app).get(path).set('Authorization', `Bearer ${createSessionToken(7)}`).expect(200);
    expect(response.headers['cache-control']).toBe('no-store');
  }
});
