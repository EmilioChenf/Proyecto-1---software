jest.mock("../../database/mysql", () => ({
  query: jest.fn(),
}));

const { query } = require("../../database/mysql");
const { getCurrentSession } = require("../authService");

describe("authService.getCurrentSession", () => {
  beforeEach(() => {
    query.mockReset();
  });

  it("devuelve el rol actual del usuario activo", async () => {
    query.mockResolvedValueOnce([
      { id: 3, email: "residente@test.com", role: "residente", activo: 1 },
    ]);

    const result = await getCurrentSession(3);

    expect(result).toEqual({ id: 3, email: "residente@test.com", role: "residente" });
  });

  it("refleja el rol actualizado que devuelve la base de datos", async () => {
    // El usuario cambio de residente a admin: el endpoint debe devolver el rol nuevo.
    query.mockResolvedValueOnce([
      { id: 3, email: "residente@test.com", role: "admin", activo: 1 },
    ]);

    const result = await getCurrentSession(3);

    expect(result.role).toBe("admin");
  });

  it("lanza un error 401 cuando el id de usuario es invalido", async () => {
    await expect(getCurrentSession(0)).rejects.toMatchObject({ status: 401 });
    await expect(getCurrentSession("abc")).rejects.toMatchObject({ status: 401 });
    expect(query).not.toHaveBeenCalled();
  });

  it("lanza un error 401 cuando el usuario no existe", async () => {
    query.mockResolvedValueOnce([]);

    await expect(getCurrentSession(99)).rejects.toMatchObject({ status: 401 });
  });

  it("lanza un error 403 cuando el usuario esta inactivo", async () => {
    query.mockResolvedValueOnce([
      { id: 4, email: "inactivo@test.com", role: "inquilino", activo: 0 },
    ]);

    await expect(getCurrentSession(4)).rejects.toMatchObject({ status: 403 });
  });
});
jest.mock('../contractHouseRelations',()=>({syncUserRelations:jest.fn(async()=>{})}));
