let handler: (() => void) | null = null;

export function onSessionExpired(cb: (() => void) | null) {
  handler = cb;
}

export function emitSessionExpired() {
  if (typeof window === 'undefined') return;
  if (window.location.pathname.startsWith('/login')) return;
  handler?.();
}
