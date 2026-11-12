const assert = require("node:assert/strict");
const test = require("node:test");

const { __private__ } = require("../src/services/residentAccountService");

test("getQuotaStatus marks fully paid quotas as paid", () => {
  assert.equal(
    __private__.getQuotaStatus(
      {
        monto: "500.00",
        total_pagado: "500.00",
        fecha_limite: "2026-08-01",
      },
      "2026-08-10",
    ),
    "PAGADA",
  );
});

test("getQuotaStatus separates overdue and pending quotas", () => {
  assert.equal(
    __private__.getQuotaStatus(
      {
        monto: "350.00",
        total_pagado: "100.00",
        fecha_limite: "2026-08-01",
      },
      "2026-08-10",
    ),
    "VENCIDA",
  );
  assert.equal(
    __private__.getQuotaStatus(
      {
        monto: "275.00",
        total_pagado: "0.00",
        fecha_limite: "2026-08-18",
      },
      "2026-08-10",
    ),
    "PENDIENTE",
  );
});

test("mapQuota converts numeric fields and house label", () => {
  const quota = __private__.mapQuota(
    {
      id_cuota: 7,
      id_casa: 2,
      torre: "B",
      numero: "302",
      servicio: "Agua potable",
      tipo_servicio: "Básico",
      monto: "350.00",
      total_pagado: "125.50",
      fecha_limite: "2026-08-01",
      ultimo_pago: "2026-07-25",
    },
    "2026-08-10",
  );

  assert.deepEqual(quota, {
    id_cuota: 7,
    id_casa: 2,
    casa_unidad: "B-302",
    servicio: "Agua potable",
    tipo_servicio: "Básico",
    monto: 350,
    monto_base: 350,
    recargo: 0,
    monto_pagado: 125.5,
    saldo_pendiente: 224.5,
    capital_pendiente: 224.5, recargo_pendiente: 0, sobrepago: 0, requiere_revision: false,
    cobrado_bruto: 125.5, reembolsado: 0, abono_neto: 125.5,
    fecha_limite: "2026-08-01",
    ultimo_pago: "2026-07-25",
    estado: "VENCIDA",
  });
});

test("buildSummary totals paid, pending and overdue quotas", () => {
  const summary = __private__.buildSummary(
    [
      { estado: "PAGADA", saldo_pendiente: 0, monto_pagado: 500, fecha_limite: "2026-08-01" },
      { estado: "VENCIDA", saldo_pendiente: 350, monto_pagado: 0, fecha_limite: "2026-08-05" },
      { estado: "PENDIENTE", saldo_pendiente: 275, monto_pagado: 0, fecha_limite: "2026-08-18" },
    ],
    "2026-08-10",
  );

  assert.equal(summary.total_cuotas, 3);
  assert.equal(summary.cuotas_pagadas, 1);
  assert.equal(summary.cuotas_vencidas, 1);
  assert.equal(summary.cuotas_pendientes, 1);
  assert.equal(summary.saldo_pendiente, 625);
  assert.equal(summary.total_pagado, 500);
  assert.equal(summary.proximo_vencimiento, "2026-08-18");
  assert.match(summary.actualizado_en, /^\d{4}-\d{2}-\d{2}T/);
});
