'use client';

import { useAuth } from '@/lib/auth/auth-provider';

export type DashboardMode = 'hris' | 'employee';

/**
 * Roles with BOTH the HRIS dashboard and their own Employee self-service
 * (choose/switch mode). Self-service data is always the user's OWN record —
 * enforced by the backend `me`/own-employee scoping.
 */
const DUAL_MODE_ROLES: ReadonlySet<string> = new Set(['hr_staff', 'hr_lead']);

export function hasDualMode(role: string | null | undefined): boolean {
  return !!role && DUAL_MODE_ROLES.has(role);
}

const KEY = 'hris_dashboard_mode';

export function readMode(): DashboardMode | null {
  if (typeof window === 'undefined') return null;
  const v = window.localStorage.getItem(KEY);
  return v === 'hris' || v === 'employee' ? v : null;
}

export function writeMode(mode: DashboardMode) {
  window.localStorage.setItem(KEY, mode);
}

export function clearMode() {
  window.localStorage.removeItem(KEY);
}

export function useDashboardMode() {
  const { user } = useAuth();
  const isDualMode = hasDualMode(user?.role);
  return { isDualMode, mode: isDualMode ? readMode() : null };
}
