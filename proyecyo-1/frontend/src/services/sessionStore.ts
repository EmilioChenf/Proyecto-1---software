// Sesión por pestaña: cada pestaña guarda su propia sesión (sessionStorage), así se pueden
// tener abiertos a la vez el administrador, el guardia, el residente y el inquilino en el
// mismo navegador. La última sesión iniciada también queda en localStorage para que una
// pestaña nueva entre directo con ella, sin volver a iniciar sesión.
export const SESSION_KEY = "nexus.session";

function safe<T>(fn: () => T, fallback: T): T {
  try { return fn(); } catch { return fallback; }
}

export function readSession(): string | null {
  const own = safe(() => window.sessionStorage.getItem(SESSION_KEY), null);
  if (own) return own;
  const last = safe(() => window.localStorage.getItem(SESSION_KEY), null);
  // La pestaña adopta la última sesión y desde ahí queda independiente.
  if (last) safe(() => window.sessionStorage.setItem(SESSION_KEY, last), undefined);
  return last;
}

export function writeSession(value: string) {
  safe(() => window.sessionStorage.setItem(SESSION_KEY, value), undefined);
  safe(() => window.localStorage.setItem(SESSION_KEY, value), undefined);
}

export function clearSession() {
  const own = safe(() => window.sessionStorage.getItem(SESSION_KEY), null);
  const last = safe(() => window.localStorage.getItem(SESSION_KEY), null);
  safe(() => window.sessionStorage.removeItem(SESSION_KEY), undefined);
  // Solo se borra la sesión compartida si es la de esta pestaña (no cierra a otro usuario).
  if (!own || own === last) safe(() => window.localStorage.removeItem(SESSION_KEY), undefined);
}

/** Id del usuario de esta pestaña, para que los avisos entre pestañas solo afecten al mismo usuario. */
export function currentSessionUserId(): number | null {
  const raw = readSession();
  if (!raw) return null;
  return safe(() => Number(JSON.parse(raw).id) || null, null);
}
