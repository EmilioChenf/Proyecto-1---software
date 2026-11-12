const assert = require("node:assert/strict");
const test = require("node:test");

const { __private__ } = require("../src/services/tenantAccountService");

test("normalizeDate valida filtros seguros", () => {
  assert.equal(__private__.normalizeDate("2026-08-01"), "2026-08-01");
  assert.throws(() => __private__.normalizeDate("01/08/2026"), /formato YYYY-MM-DD/);
});

test("isRentQuota detects rent concepts by service name or type", () => {
  assert.equal(__private__.isRentQuota({ servicio: "Alquiler residencial", tipo_servicio: "" }), true);
  assert.equal(__private__.isRentQuota({ servicio: "Cuota mensual", tipo_servicio: "Renta" }), true);
  assert.equal(__private__.isRentQuota({ servicio: "Agua potable", tipo_servicio: "Básico" }), false);
});

test("getQuotaStatus separates paid, overdue and pending tenant quotas", () => {
  assert.equal(
    __private__.getQuotaStatus(
      {
        monto: "2200.00",
        total_pagado: "2200.00",
        fecha_limite: "2026-08-31",
      },
      "2026-08-10",
    ),
    "PAGADA",
  );
  assert.equal(
    __private__.getQuotaStatus(
      {
        monto: "350.00",
        total_pagado: "0.00",
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

test("mapQuota marks rent and converts monetary fields", () => {
  const quota = __private__.mapQuota(
    {
      id_cuota: 10,
      id_casa: 4,
      torre: "B",
      numero: "302",
      servicio: "Alquiler residencial",
      tipo_servicio: "Alquiler",
      monto: "2200.00",
      total_pagado: "500.00",
      fecha_limite: "2026-08-31",
      ultimo_pago: "2026-08-05",
    },
    "2026-08-10",
  );

  assert.deepEqual(quota, {
    id_cuota: 10,
    id_casa: 4,
    casa_unidad: "B-302",
    servicio: "Alquiler residencial",
    tipo_servicio: "Alquiler",
    monto: 2200,
    monto_base: 2200,
    recargo: 0,
    monto_pagado: 500,
    saldo_pendiente: 1700,
    capital_pendiente: 1700, recargo_pendiente: 0, sobrepago: 0, requiere_revision: false,
    cobrado_bruto: 500, reembolsado: 0, abono_neto: 500,
    fecha_limite: "2026-08-31",
    ultimo_pago: "2026-08-05",
    estado: "PENDIENTE",
    es_alquiler: true,
  });
});

test("buildSummary separates rent and additional pending balances", () => {
  const summary = __private__.buildSummary(
    [
      {
        estado: "PENDIENTE",
        saldo_pendiente: 2200,
        monto_pagado: 0,
        fecha_limite: "2026-08-31",
        es_alquiler: true,
      },
      {
        estado: "VENCIDA",
        saldo_pendiente: 350,
        monto_pagado: 0,
        fecha_limite: "2026-08-01",
        es_alquiler: false,
      },
      {
        estado: "PAGADA",
        saldo_pendiente: 0,
        monto_pagado: 500,
        fecha_limite: "2026-08-05",
        es_alquiler: false,
      },
    ],
    "2026-08-10",
  );

  assert.equal(summary.total_cuotas, 3);
  assert.equal(summary.cuotas_pendientes, 1);
  assert.equal(summary.cuotas_vencidas, 1);
  assert.equal(summary.cuotas_pagadas, 1);
  assert.equal(summary.saldo_pendiente, 2550);
  assert.equal(summary.alquiler_pendiente, 2200);
  assert.equal(summary.cuotas_adicionales_pendientes, 350);
  assert.equal(summary.total_pagado, 500);
  assert.equal(summary.proximo_vencimiento, "2026-08-31");
});
