const { query } = require("../database/mysql");

async function listUserTypes() {
  const rows = await query(
    `
      SELECT
        id_tipo_usuario AS id,
        nombre,
        personalizado,
        descripcion,
        color
      FROM TIPO_USUARIO
      ORDER BY personalizado ASC, nombre ASC
    `,
  );

  return rows.map((row) => ({ ...row, personalizado: Number(row.personalizado) === 1 }));
}

module.exports = {
  listUserTypes,
};
