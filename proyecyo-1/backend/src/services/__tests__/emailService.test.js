describe("emailService con SMTP (Gmail)", () => {
  const saved = { ...process.env };
  afterEach(() => { process.env = { ...saved }; jest.resetModules(); });

  function load(extra) {
    Object.assign(process.env, { NODE_ENV: "test", EMAIL_API_URL: "", ...extra });
    jest.resetModules();
    return require("../emailService");
  }

  test("envia el correo de recuperacion por SMTP desde la cuenta de Gmail", async () => {
    const email = load({ SMTP_USER: "avisos@gmail.com", SMTP_PASS: "abcd efgh ijkl mnop", EMAIL_FROM: "otro@dominio.com" });
    const sendMail = jest.fn(async () => ({ messageId: "m1" }));
    email.setEmailTransportForTests({ sendMail });

    await expect(email.sendPasswordResetEmail({ to: "ana@test.com", name: "Ana", resetUrl: "https://app.test/restablecer?token=1" }))
      .resolves.toEqual({ delivered: true, messageId: "m1" });
    const message = sendMail.mock.calls[0][0];
    expect(message.from).toBe('"NexusResidencial" <avisos@gmail.com>');
    expect(message.to).toBe("ana@test.com");
    expect(message.html).toContain("https://app.test/restablecer?token=1");
    expect(message.text).toContain("https://app.test/restablecer?token=1");
  });

  test("quita los espacios de la clave de aplicacion", () => {
    load({ SMTP_USER: "avisos@gmail.com", SMTP_PASS: "abcd efgh ijkl mnop" });
    expect(require("../../config/env").env.SMTP_PASS).toBe("abcdefghijklmnop");
  });

  test("sin SMTP ni API no envia y lo reporta", async () => {
    const email = load({ SMTP_USER: "", SMTP_PASS: "" });
    expect(email.isEmailConfigured()).toBe(false);
    await expect(email.sendEmail({ to: "a@b.com", subject: "s", text: "t", html: "h" })).resolves.toEqual({ delivered: false, reason: "NO_CONFIGURADO" });
  });
});
