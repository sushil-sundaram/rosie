export const API = "/api";
export const CLIENT_ID = (crypto.randomUUID && crypto.randomUUID()) || String(Math.random()).slice(2);

let authState = { required: false, authenticated: true };
let onAuthLost = () => {};
let onNotFoundWrite = () => {};

export function getAuthState() {
  return authState;
}

export function setAuthState(next) {
  authState = { ...authState, ...next };
}

export function setApiHooks({ authLost, notFoundWrite }) {
  if (authLost) onAuthLost = authLost;
  if (notFoundWrite) onNotFoundWrite = notFoundWrite;
}

export async function api(path, opts = {}) {
  const res = await fetch(API + path, {
    headers: { "Content-Type": "application/json", "X-Client-Id": CLIENT_ID },
    ...opts,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  let data = null;
  const text = await res.text().catch(() => "");
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = res.ok ? null : { error: text.slice(0, 200) };
  }
  if (!res.ok) {
    if (res.status === 401 && path !== "/auth/login") {
      authState = { required: true, authenticated: false };
      onAuthLost();
    }
    if (res.status === 404 && opts.method && opts.method !== "GET") {
      setTimeout(() => onNotFoundWrite(), 0);
    }
    throw new Error((data && (data.error || data.message)) || `HTTP ${res.status}`);
  }
  return data;
}
