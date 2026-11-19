let handler: (() => void) | null = null;

export const SESSION_EXPIRED_MESSAGE = 'Sesi Anda berakhir, silakan login ulang.';
// DRF's NotAuthenticated detail (session cookie missing or expired).
const NOT_AUTHENTICATED_DETAIL = 'Authentication credentials were not provided.';
const EXPIRED_FLAG = 'hris-session-expired';

export function onSessionExpired(cb: (() => void) | null) {
  handler = cb;
}

export function emitSessionExpired() {
  if (typeof window === 'undefined') return;
  if (window.location.pathname.startsWith('/login')) return;
  handler?.();
}

/** Remember (for the login page) that the user was signed out by expiry. */
export function markSessionExpired() {
  try {
    sessionStorage.setItem(EXPIRED_FLAG, '1');
  } catch {
    // storage unavailable: the login page simply shows no notice
  }
}

/** True once after an expiry sign-out; clears the flag. */
export function consumeSessionExpired(): boolean {
  try {
    const expired = sessionStorage.getItem(EXPIRED_FLAG) === '1';
    sessionStorage.removeItem(EXPIRED_FLAG);
    return expired;
  } catch {
    return false;
  }
}

let guardInstalled = false;

/**
 * Wrap window.fetch once: an API response saying the session is gone gets an
 * Indonesian detail (so every module's error toast reads the same) and signs
 * the user out of the app, which sends them to /login. The presence heartbeat
 * and login calls are left alone.
 */
export function installSessionGuard() {
  if (guardInstalled || typeof window === 'undefined') return;
  guardInstalled = true;
  const originalFetch = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const res = await originalFetch(input, init);
    if (res.status !== 401 && res.status !== 403) return res;
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.includes('/api/auth/heartbeat/') || url.includes('/api/auth/login/')) return res;
    const body = await res.clone().json().catch(() => null);
    if (body?.detail !== NOT_AUTHENTICATED_DETAIL) return res;

    emitSessionExpired();
    const headers = new Headers(res.headers);
    headers.delete('content-length');
    headers.set('content-type', 'application/json');
    return new Response(JSON.stringify({ detail: SESSION_EXPIRED_MESSAGE }), {
      status: res.status,
      statusText: res.statusText,
      headers
    });
  };
}
