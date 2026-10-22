const express = require("express");

const { login, logout, session } = require("../controllers/authController");
const { changeForgottenPassword, changePassword, forgotPassword } = require("../controllers/passwordResetController");
const { requireRoles } = require("../middlewares/requireRoles");

const router = express.Router();
const requireUser = requireRoles(["admin", "guardia", "residente", "inquilino"]);

router.post("/login", login);
router.post("/auth/logout", logout);
router.get("/auth/session", session);
router.post("/auth/password/forgot", forgotPassword);
router.post("/auth/password/reset", changeForgottenPassword);
router.post("/auth/password/change", requireUser, changePassword);

module.exports = router;
