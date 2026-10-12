jest.mock('../../database/mysql', () => ({ query: jest.fn(), pool: {} }));
const { __private__: rules } = require('../financialNotificationsService');
const { calculateBalance } = require('../financialBalance');
test('destinatarios usan relaciones activas y la unidad del estado de cuenta', async () => {
 const c = {execute:jest.fn().mockResolvedValue([[{id_usuario:10},{id_usuario:20}]])};
 expect(await rules.recipients(c,27)).toEqual([10,20]);
 const [sql,args]=c.execute.mock.calls[0];expect(args).toEqual([27]);
 expect(sql).toContain('u.id_usuario=q.id_responsable');expect(sql).toContain('u.activo=TRUE');expect(sql).toContain('ca.relaciones_confirmadas_en IS NULL');
});
test('recordatorio excluye alquiler/renta del propietario sin ampliar permisos',async()=>{
 const c={execute:jest.fn().mockResolvedValue([[]])};await rules.recipients(c,1);
 expect(c.execute.mock.calls[0][0]).toContain("LOWER(s.nombre) NOT LIKE '%renta%'");
 expect(c.execute.mock.calls[0][0]).toContain("LOWER(COALESCE(s.tipo_servicio,'')) <> 'alquiler'");
});
test('mensaje utiliza saldo can?nico y recargos realmente pendientes',()=>{
 const q={id_cuota:1,servicio:'Mantenimiento',vencimiento:'2026-10-01',balance:calculateBalance({monto:100,recargo:15,pagado:10})};
 const data=rules.deadlineData(q,10,0,{type:'CUOTA_VENCIDA',window:'INICIAL',date:'2026-10-04'});
 expect(data.monto_centavos).toBe(10500);expect(data.recargo_centavos).toBe(500);
 expect(data.mensaje).toContain('Q105.00');expect(data.mensaje).toContain('recargos pendientes de Q5.00');
 expect(data.mensaje).not.toContain('evitar recargos');
});
