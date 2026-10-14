import { getApiErrorMessage, getFieldErrors, type FieldError } from "@/utils/errorMessages";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3000";
const SESSION_STORAGE_KEY = "nexus.session";

type RequestOptions = Omit<RequestInit, "body"> & {
  body?: unknown;
};

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public payload?: unknown,
    public fieldErrors: FieldError[] = [],
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function getRequestHeaders(initial?: HeadersInit) {
  const headers = new Headers(initial);
  headers.set("Content-Type", "application/json");

  const rawSession = window.localStorage.getItem(SESSION_STORAGE_KEY);

  if (rawSession) {
    try {
      const session = JSON.parse(rawSession) as { token?: string };

      if (session.token) {
        headers.set("Authorization", `Bearer ${session.token}`);
      }
    } catch {
      window.localStorage.removeItem(SESSION_STORAGE_KEY);
    }
  }

  return headers;
}

async function getPayload(response: Response) {
  const text = await response.text();
  if (!text) return null;
  try { return JSON.parse(text) as unknown; } catch { return { message: text }; }
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      ...options,
      headers: getRequestHeaders(options.headers),
      body: options.body === undefined ? undefined
        : typeof options.body === "string" ? options.body : JSON.stringify(options.body),
    });
  } catch {
    throw new ApiError("No se pudo conectar con el servidor. Revisa tu conexión e intenta nuevamente.", 0);
  }

  const payload = await getPayload(response);

  if (!response.ok) {
    if (response.status === 401 && path !== "/login") {
      window.dispatchEvent(new Event("nexus:session-expired"));
    }
    throw new ApiError(
      getApiErrorMessage(response.status, payload),
      response.status,
      payload,
      getFieldErrors(payload),
    );
  }

  return payload as T;
}

export async function apiDownloadResponse(path: string, options: Pick<RequestInit, 'signal'> = {}) {
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, { ...options, headers: getRequestHeaders() });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw new ApiError("No se pudo conectar con el servidor. Revisa tu conexión e intenta nuevamente.", 0);
  }
  if (!response.ok) {
    const payload = await getPayload(response);
    if (response.status === 401) window.dispatchEvent(new Event("nexus:session-expired"));
    throw new ApiError(getApiErrorMessage(response.status, payload), response.status, payload, getFieldErrors(payload));
  }
  return response;
}

export async function apiDownload(path: string) {
  return (await apiDownloadResponse(path)).blob();
}
