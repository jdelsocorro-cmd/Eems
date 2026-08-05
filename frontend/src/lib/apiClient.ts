import { supabase } from "./supabaseClient";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;

class ApiError extends Error {
  constructor(
    public status: number,
    public detail: string,
  ) {
    super(detail);
  }
}

function formatDetail(detail: unknown, fallback: string): string {
  // FastAPI returns a plain string detail for most errors, but Pydantic
  // validation failures (422) come back as an array of {msg, loc, ...}
  // objects -- rendering that array directly as JSX children crashes
  // React with no error boundary to catch it, so it's normalized to a
  // string here once rather than in every page's error handling.
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((d) => (typeof d === "string" ? d : typeof d?.msg === "string" ? d.msg : JSON.stringify(d)))
      .join("; ");
  }
  if (detail && typeof detail === "object") return JSON.stringify(detail);
  return fallback;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  // A FormData body (file uploads) must NOT get an explicit Content-Type --
  // the browser sets its own multipart/form-data boundary automatically,
  // and overriding it with application/json breaks the upload silently
  // (the server sees a JSON content-type with a multipart body).
  const isFormData = init.body instanceof FormData;

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      ...(isFormData ? {} : { "Content-Type": "application/json" }),
      ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}),
      ...init.headers,
    },
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({ detail: response.statusText }));
    throw new ApiError(response.status, formatDetail(body.detail, response.statusText));
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

async function requestBlob(path: string): Promise<Blob> {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: session ? { Authorization: `Bearer ${session.access_token}` } : {},
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({ detail: response.statusText }));
    throw new ApiError(response.status, formatDetail(body.detail, response.statusText));
  }

  return response.blob();
}

export const apiClient = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown) => request<T>(path, { method: "POST", body: JSON.stringify(body) }),
  postForm: <T>(path: string, formData: FormData) => request<T>(path, { method: "POST", body: formData }),
  patch: <T>(path: string, body: unknown) => request<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
  getBlob: (path: string) => requestBlob(path),
};

export { ApiError };
