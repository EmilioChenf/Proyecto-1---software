const { after, beforeEach, describe, it, mock } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const request = require("supertest");

function httpError(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}

const behavior = {};
const calls = {
  createVisit: mock.fn((...args) => behavior.createVisit(...args)),
  getGuardShiftVisits: mock.fn((...args) => behavior.getGuardShiftVisits(...args)),
  registerQrEntry: mock.fn((...args) => behavior.registerQrEntry(...args)),
  listNotifications: mock.fn((...args) => behavior.listNotifications(...args)),
  markNotificationAsRead: mock.fn((...args) => behavior.markNotificationAsRead(...args)),
  validateAmenityReservationConflict: mock.fn((...args) =>
    behavior.validateAmenityReservationConflict(...args),
  ),
  listAdminAccesses: mock.fn((...args) => behavior.listAdminAccesses(...args)),
  registerProvider: mock.fn((...args) => behavior.registerProvider(...args)),
  adminCancelAmenityReservation: mock.fn((...args) => behavior.adminCancelAmenityReservation(...args)),
  listReservationsByRange: mock.fn((...args) => behavior.listReservationsByRange(...args)),
  listReservationHistory: mock.fn((...args) => behavior.listReservationHistory(...args)),
};

const noop = async () => {
  throw new Error("Servicio falso sin configurar para esta prueba.");
};

const serviceFakes = {
  "visitsService.js": {
    listResidentVisits: noop,
    listFrequentVisitors: noop,
    createVisit: calls.createVisit,
    updateVisit: noop,
    deleteVisit: noop,
    cancelVisit: noop,
    deleteFrequentVisitor: noop,
    getGuardShiftVisits: calls.getGuardShiftVisits,
    validateQrVisit: noop,
    registerQrEntry: calls.registerQrEntry,
  },
  "amenitiesReservationsService.js": {
    listAmenities: noop,
    listReservableUsers: noop,
    listReservationsByRange: calls.listReservationsByRange,
    listReservationHistory: calls.listReservationHistory,
    getAmenityAvailability: noop,
    validateAmenityReservationConflict: calls.validateAmenityReservationConflict,
    createAmenityReservation: noop,
    updateAmenityReservation: noop,
    cancelAmenityReservation: noop,
    adminCancelAmenityReservation: calls.adminCancelAmenityReservation,
    getAmenityStats: noop,
    updateAmenitySchedule: noop,
  },
  "notificationsService.js": {
    listNotifications: calls.listNotifications,
    countUnreadNotifications: noop,
    markNotificationAsRead: calls.markNotificationAsRead,
    markAllNotificationsAsRead: noop,
  },
  "adminAccessesService.js": {
    getAdminAccessSummary: noop,
    getAdminAccessHourlyChart: noop,
    getAdminAccessDailyChart: noop,
    listAdminAccesses: calls.listAdminAccesses,
  },
  "tenantProvidersService.js": {
    listTenantProviders: noop,
    getTenantProvidersHistory: noop,
    listOwnerProviders: noop,
    registerProvider: calls.registerProvider,
    updateTenantProvider: noop,
    updateOwnerProviderValidation: noop,
  },
};

const originalCacheEntries = new Map();

function replaceModule(relativePath, exports) {
  const filename = path.resolve(__dirname, "..", relativePath);
  originalCacheEntries.set(filename, require.cache[filename]);
  require.cache[filename] = {
    id: filename,
    filename,
    loaded: true,
    exports,
    children: [],
    paths: [],
  };
}

for (const [filename, exports] of Object.entries(serviceFakes)) {
  replaceModule(path.join("src", "services", filename), exports);
}

replaceModule(path.join("src", "database", "mysql.js"), {
  query: mock.fn(() => {
    throw new Error("La prueba intento consultar MySQL.");
  }),
  pool: {
    getConnection: mock.fn(() => {
      throw new Error("La prueba intento abrir una conexion MySQL.");
    }),
  },
});

const { createApp } = require("../src/app");
const app = createApp();

after(() => {
  for (const [filename, original] of originalCacheEntries) {
    if (original) {
      require.cache[filename] = original;
    } else {
      delete require.cache[filename];
    }
  }
});

beforeEach(() => {
  mock.reset();
  for (const serviceCall of Object.values(calls)) {
    serviceCall.mock.resetCalls();
  }
  behavior.createVisit = noop;
  behavior.getGuardShiftVisits = noop;
  behavior.registerQrEntry = noop;
  behavior.listNotifications = noop;
  behavior.markNotificationAsRead = noop;
  behavior.validateAmenityReservationConflict = noop;
  behavior.listAdminAccesses = noop;
  behavior.registerProvider = noop;
  behavior.adminCancelAmenityReservation = noop;
  behavior.listReservationsByRange = noop;
  behavior.listReservationHistory = noop;
});

function authenticated(agent, role, userId = 7) {
  return agent.set("x-user-role", role).set("x-user-id", String(userId));
}

describe("Rutas reales de NexusResidencial", () => {
  it("HU-C05.6: el historial del inquilino usa su identidad, aunque envíe otro usuario", async () => {
    behavior.listReservationsByRange = async () => [{ estado: "CANCELADA" }];
    behavior.listReservationHistory = async () => [{ accion: "CANCELACION_ADMIN" }];
    const response = await authenticated(request(app).get("/inquilino/reservas/amenidades?from=2099-01-01&to=2099-01-31&id_usuario=999"), "inquilino", 7);
    assert.equal(response.status, 200);
    assert.deepEqual(calls.listReservationsByRange.mock.calls[0].arguments, ["2099-01-01", "2099-01-31", { id_usuario: 7, includeUserDetails: true, includeCanceled: true }]);
    const history = await authenticated(request(app).get("/inquilino/reservas/amenidades/historial?id_usuario=999"), "inquilino", 7);
    assert.equal(history.status, 200);
    assert.deepEqual(calls.listReservationHistory.mock.calls[0].arguments, [7]);
  });

  it("HU-C05.12: otros roles no entran al historial privado del inquilino", async () => {
    for (const path of ["/inquilino/reservas/amenidades", "/inquilino/reservas/amenidades/historial"]) {
      assert.equal((await request(app).get(path)).status, 401);
      for (const role of ["guardia", "residente", "admin"]) assert.equal((await authenticated(request(app).get(path), role)).status, 403);
    }
    assert.equal(calls.listReservationsByRange.mock.callCount(), 0);
    assert.equal(calls.listReservationHistory.mock.callCount(), 0);
  });

  it("consulta las notificaciones del usuario autenticado", async () => {
    const notifications = [
      {
        id_notificacion: 41,
        tipo: "LLEGADA_VISITA",
        titulo: "Visita en garita",
        leido: false,
      },
    ];
    behavior.listNotifications = async () => notifications;

    const response = await authenticated(request(app).get("/notificaciones"), "residente", 12);

    assert.equal(response.status, 200);
    assert.deepEqual(response.body, notifications);
    assert.deepEqual(calls.listNotifications.mock.calls[0].arguments, [12]);
  });

  it("rechaza la creacion de una visita con datos invalidos", async () => {
    behavior.createVisit = async (_userId, _role, payload) => {
      if (!payload.nombre) {
        throw httpError("El nombre del visitante es obligatorio.", 400);
      }
      return payload;
    };

    const response = await authenticated(request(app).post("/visitas"), "inquilino", 18).send({
      fecha: "2026-07-20",
      hora_inicio: "09:00",
      hora_fin: "10:00",
      tipo_visita: "PERSONAL",
    });

    assert.equal(response.status, 400);
    assert.deepEqual(response.body, { message: "El nombre del visitante es obligatorio." });
    assert.equal(calls.createVisit.mock.callCount(), 1);
    assert.equal(calls.createVisit.mock.calls[0].arguments[0], 18);
    assert.equal(calls.createVisit.mock.calls[0].arguments[1], "inquilino");
  });

  it("crea correctamente una visita autorizada", async () => {
    const payload = {
      nombre: "Carlos Ruiz",
      fecha: "2026-07-20",
      hora_inicio: "09:00",
      hora_fin: "10:00",
      tipo_visita: "VISITA",
    };
    const created = {
      id_acceso: 82,
      ...payload,
      token_qr: "qr-carlos-82",
      estado_acceso: "AUTORIZADA",
    };
    behavior.createVisit = async () => created;

    const response = await authenticated(request(app).post("/visitas"), "residente", 14).send(payload);

    assert.equal(response.status, 201);
    assert.deepEqual(response.body, created);
    assert.deepEqual(calls.createVisit.mock.calls[0].arguments, [14, "residente", payload]);
  });

  it("valida un QR de visita desde la ruta de guardia", async () => {
    const visit = {
      id_acceso: 73,
      visitante: "Maria Gomez",
      qr_status: "USED",
      estado_acceso: "INGRESO",
    };
    behavior.registerQrEntry = async () => visit;

    const response = await authenticated(
      request(app).post("/guardia/validar-qr"),
      "guardia",
      3,
    ).send({ qrToken: "qr-nexus-73" });

    assert.equal(response.status, 200);
    assert.deepEqual(response.body, visit);
    // HU-C08: el guardia ejecutor sale de la sesion validada, nunca del cuerpo.
    const [token, guardId, metadata] = calls.registerQrEntry.mock.calls[0].arguments;
    assert.deepEqual([token, guardId], ["qr-nexus-73", 3]);
    assert.equal(typeof metadata, "object");
  });

  it("informa un conflicto de horario para una reserva", async () => {
    const conflict = {
      conflicto: true,
      reserva: { id_amenidad: 2, fecha: "2026-07-25", hora_inicio: "10:00" },
    };
    behavior.validateAmenityReservationConflict = async () => conflict;

    const response = await authenticated(
      request(app)
        .get("/reservas/amenidades/conflicto")
        .query({
          id_amenidad: 2,
          fecha: "2026-07-25",
          hora_inicio: "10:00",
          hora_fin: "11:00",
        }),
      "residente",
      9,
    );

    assert.equal(response.status, 200);
    assert.deepEqual(response.body, conflict);
    const [query, options] =
      calls.validateAmenityReservationConflict.mock.calls[0].arguments;
    assert.deepEqual(Object.fromEntries(Object.entries(query)), {
      id_amenidad: "2",
      fecha: "2026-07-25",
      hora_inicio: "10:00",
      hora_fin: "11:00",
      id_usuario: 9,
    });
    assert.deepEqual(options, {
      includeUserDetails: false,
      requireUserId: false,
      validateUserLimit: true,
    });
  });

  it("impide que un residente consulte las visitas exclusivas de guardia", async () => {
    behavior.getGuardShiftVisits = async () => [];

    const response = await authenticated(
      request(app).get("/guardia/visitas"),
      "residente",
      12,
    );

    assert.equal(response.status, 403);
    assert.deepEqual(response.body, { message: "Acceso restringido a guardias." });
    assert.equal(calls.getGuardShiftVisits.mock.callCount(), 0);
  });

  it("obtiene la lista de accesos para administracion", async () => {
    const accesses = [
      { id_acceso: 51, visitante: "Luis Diaz", tipo: "VISITA", estado: "AUTORIZADA" },
    ];
    behavior.listAdminAccesses = async () => accesses;

    const response = await authenticated(
      request(app).get("/admin/accesos").query({ search: "Luis", status: "AUTORIZADA" }),
      "admin",
      1,
    );

    assert.equal(response.status, 200);
    assert.deepEqual(response.body, accesses);
    const [filters] = calls.listAdminAccesses.mock.calls[0].arguments;
    assert.deepEqual(Object.fromEntries(Object.entries(filters)), {
      search: "Luis",
      status: "AUTORIZADA",
    });
  });

  it("registra correctamente un proveedor del inquilino", async () => {
    const payload = {
      nombre: "Electricidad Lopez",
      motivo_servicio: "Electricidad",
      medio_ingreso: "VEHICULO",
      placa: "P-123ABC",
      fecha: "2999-01-01",
      hora_inicio: "09:00",
      hora_fin: "11:00",
    };
    const result = {
      proveedor: { id_servicio: 33, nombre: payload.nombre, activo: true, estado: "PENDIENTE" },
      acceso: { id_acceso: 90, tipo_visita: "PROVEEDOR", medio_ingreso: "VEHICULO" },
    };
    behavior.registerProvider = async () => result;

    const response = await authenticated(
      request(app).post("/inquilino/proveedores"),
      "inquilino",
      21,
    ).send(payload);

    assert.equal(response.status, 201);
    assert.deepEqual(response.body, result);
    assert.deepEqual(calls.registerProvider.mock.calls[0].arguments, [
      { id: 21, role: "inquilino" },
      payload,
    ]);
  });

  // HU-C06.1/C06.2: cada rol registra proveedores solo en su propia ruta.
  it("el residente y el administrador registran proveedores en sus rutas", async () => {
    behavior.registerProvider = async () => ({ proveedor: { id_servicio: 1 }, acceso: { id_acceso: 2 } });
    const payload = { nombre: "Plomeria", motivo_servicio: "Plomeria", id_casa: 4 };

    const owner = await authenticated(request(app).post("/residente/proveedores"), "residente", 30).send(payload);
    const admin = await authenticated(request(app).post("/admin/proveedores"), "admin", 1).send(payload);

    assert.equal(owner.status, 201);
    assert.equal(admin.status, 201);
    assert.deepEqual(calls.registerProvider.mock.calls.map((call) => call.arguments[0]), [
      { id: 30, role: "residente" },
      { id: 1, role: "admin" },
    ]);
  });

  it("rechaza el registro de proveedores en rutas de otro rol", async () => {
    const attempts = [
      ["/inquilino/proveedores", "residente"],
      ["/residente/proveedores", "inquilino"],
      ["/admin/proveedores", "residente"],
      ["/admin/proveedores", "guardia"],
      ["/inquilino/proveedores", "guardia"],
    ];

    for (const [url, role] of attempts) {
      const response = await authenticated(request(app).post(url), role).send({ nombre: "X" });
      assert.equal(response.status, 403, `${role} en ${url}`);
    }
    assert.equal(calls.registerProvider.mock.callCount(), 0);
  });

  // HU-C05.4/C05.12: solo un administrador cancela reservas ajenas; su identidad sale
  // de la sesion y nunca del cuerpo de la peticion.
  it("solo el administrador cancela reservas desde la ruta administrativa", async () => {
    const url = "/admin/reservas/amenidades/9-2-2099-01-10-10:00/cancelar";
    for (const role of ["residente", "inquilino", "guardia"]) {
      const response = await authenticated(request(app).patch(url), role).send({ motivo: "x" });
      assert.equal(response.status, 403, role);
    }
    assert.equal((await request(app).patch(url).send({})).status, 401);
    assert.equal(calls.adminCancelAmenityReservation.mock.callCount(), 0);

    behavior.adminCancelAmenityReservation = async () => ({ estado: "CANCELADA" });
    const response = await authenticated(request(app).patch(url), "admin", 3).send({ motivo: "Mantenimiento", id_usuario: 99 });
    assert.equal(response.status, 200);
    assert.deepEqual(calls.adminCancelAmenityReservation.mock.calls[0].arguments, [
      { role: "admin", id: 3 },
      "9-2-2099-01-10-10:00",
      { motivo: "Mantenimiento", id_usuario: 99 },
    ]);
  });

  it("las consultas de proveedores del inquilino ya no aceptan residentes", async () => {
    const response = await authenticated(request(app).get("/inquilino/proveedores"), "residente");
    assert.equal(response.status, 403);
  });

  it("devuelve 404 cuando la notificacion no pertenece al usuario", async () => {
    behavior.markNotificationAsRead = async () => {
      throw httpError("Notificacion no encontrada.", 404);
    };

    const response = await authenticated(
      request(app).patch("/notificaciones/999/leida"),
      "residente",
      12,
    );

    assert.equal(response.status, 404);
    assert.deepEqual(response.body, { message: "Notificacion no encontrada." });
    assert.deepEqual(calls.markNotificationAsRead.mock.calls[0].arguments, [12, "999"]);
  });
});
