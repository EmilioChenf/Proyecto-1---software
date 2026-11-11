// Prepara la base de datos de un residencial nuevo con las variables BOOTSTRAP_* y DB_*.
// Uso: npm run bootstrap:residencial   (el servidor tambien lo hace al iniciar)
const { env } = require("../src/config/env");
const { bootstrapFromEnvironment } = require("../src/database/bootstrapResidencial");

bootstrapFromEnvironment(env, console, { strict: true })
  .then((result) => {
    if (!result) {
      console.error("Define BOOTSTRAP_ADMIN_CORREO, BOOTSTRAP_ADMIN_PASSWORD y BOOTSTRAP_RESIDENCIAL_NOMBRE.");
      process.exitCode = 1;
      return;
    }
    console.log(JSON.stringify(result));
  })
  .catch((error) => {
    console.error(error.code === "BOOTSTRAP_INVALIDO" ? error.message : `No fue posible preparar el residencial (${error.code || error.name}).`);
    process.exitCode = 1;
  });
