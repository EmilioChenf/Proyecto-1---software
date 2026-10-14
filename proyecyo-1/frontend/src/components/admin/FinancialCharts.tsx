import { BarChart, Bar, CartesianGrid, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { financialMoney, type FinancialDashboard } from '@/services/financialDashboardService';

export function FinancialCharts({ data }: { data: FinancialDashboard }) {
  const hasMovements = data.serie.some(day => day.cobrado !== 0 || day.devuelto !== 0);
  return <section aria-label="Comportamiento financiero" className="space-y-6">
    <div className="rounded-xl border bg-white p-4">
      <h2 className="text-lg font-semibold">Cobros y devoluciones por día</h2>
      {!hasMovements ? <p className="mt-3">Sin movimientos registrados en este período.</p> :
        <div className="mt-4 h-72" role="img" aria-label="Gráfica diaria de cobros y devoluciones en quetzales">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.serie} accessibilityLayer>
              <CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="fecha" tickFormatter={date => date.slice(5)} /><YAxis />
              <Tooltip formatter={(value: number) => financialMoney(value)} /><Legend />
              <Bar name="Cobros" dataKey="cobrado" fill="#2563eb" /><Bar name="Devoluciones" dataKey="devuelto" fill="#b45309" />
            </BarChart>
          </ResponsiveContainer>
        </div>}
      {data.serie.length > 0 && <details className="mt-4">
        <summary className="cursor-pointer text-blue-700">Consultar valores por día</summary>
        <p className="my-3 text-sm text-slate-600">El neto resta las devoluciones a los cobros del día; puede ser negativo aunque no haya cobros nuevos.</p>
        <div className="max-h-96 overflow-auto rounded border" tabIndex={0} role="region" aria-label="Valores diarios desplazables">
          <table className="w-full text-left text-sm">
            <caption className="p-2 text-left font-medium">Movimientos diarios en quetzales</caption>
            <thead className="sticky top-0 bg-slate-50"><tr>{['Fecha', 'Cobros', 'Devoluciones', 'Neto'].map(label => <th key={label} scope="col" className="p-2">{label}</th>)}</tr></thead>
            <tbody>{data.serie.map(day => <tr key={day.fecha} className="border-t"><th scope="row" className="whitespace-nowrap p-2"><time dateTime={day.fecha}>{day.fecha}</time></th>
              <td className="whitespace-nowrap p-2">{financialMoney(day.cobrado)}</td><td className="whitespace-nowrap p-2">{financialMoney(day.devuelto)}</td><td className="whitespace-nowrap p-2">{financialMoney(day.neto)}</td></tr>)}</tbody>
          </table>
        </div>
      </details>}
    </div>
    <div className="rounded-xl border bg-white p-4">
      <h2 className="text-lg font-semibold">Deuda actual por concepto</h2>
      {data.conceptos.length === 0 ? <p className="mt-3">No hay deuda pendiente.</p> : <div className="mt-4 overflow-x-auto">
        <table className="w-full text-left text-sm"><caption className="sr-only">Capital, recargos y saldo actual por concepto</caption>
          <thead><tr>{['Concepto', 'Cuotas', 'Capital', 'Recargos', 'Pendiente'].map(label => <th scope="col" key={label} className="p-2">{label}</th>)}</tr></thead>
          <tbody>{data.conceptos.map(item => <tr key={item.concepto} className="border-t"><th scope="row" className="p-2">{item.concepto.replaceAll('_', ' ')}</th>
            <td className="p-2">{item.cuotas}</td><td className="p-2">{financialMoney(item.capital)}</td><td className="p-2">{financialMoney(item.recargo)}</td><td className="p-2">{financialMoney(item.pendiente)}</td></tr>)}</tbody>
        </table>
      </div>}
    </div>
  </section>;
}
