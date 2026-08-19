export const AUTH_API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

export const AUTH_ENDPOINTS = {
  login: `${AUTH_API_BASE}/api/auth/login/`,
  logout: `${AUTH_API_BASE}/api/auth/logout/`,
  me: `${AUTH_API_BASE}/api/auth/me/`
};
