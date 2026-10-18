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
  createTenantProvider: mock.fn((...args) => behavior.createTenantProvider(...args)),
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
    listReservationsByRange: noop,
    listReservationHistory: noop,
    getAmenityAvailability: noop,
    validateAmenityReservationConflict: calls.validateAmenityReservationConflict,
    createAmenityReservation: noop,
    updateAmenityReservation: noop,
    cancelAmenityReservation: noop,
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
    createTenantProvider: calls.createTenantProvider,
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
  behavior.createTenantProvider = noop;
});

function authenticated(agent, role, userId = 7) {
  return agent.set("x-user-role", role).set("x-user-id", String(userId));
}

describe("Rutas reales de NexusResidencial", () => {
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
      tipo_servicio: "ELECTRICIDAD",
      descripcion: "Mantenimiento residencial",
    };
    const provider = {
      id_servicio: 33,
      ...payload,
      activo: true,
      estado: "PENDIENTE",
    };
    behavior.createTenantProvider = async () => provider;

    const response = await authenticated(
      request(app).post("/inquilino/proveedores"),
      "inquilino",
      21,
    ).send(payload);

    assert.equal(response.status, 201);
    assert.deepEqual(response.body, provider);
    assert.deepEqual(calls.createTenantProvider.mock.calls[0].arguments, [21, payload]);
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
