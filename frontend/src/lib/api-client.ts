import { emitSessionExpired } from '@/lib/session-events';

const BASE_URL = '/api';

export async function apiClient<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${endpoint}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  });

  if (res.status === 401 || res.status === 403) {
    emitSessionExpired();
    throw new Error(`API error: ${res.status} ${res.statusText}`);
  }

  if (!res.ok) {
    throw new Error(`API error: ${res.status} ${res.statusText}`);
  }

  return res.json() as Promise<T>;
}
