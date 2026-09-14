'use client';

import { useAuth } from '@/lib/auth/auth-provider';

export type DashboardMode = 'hris' | 'employee';

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
  const isHrStaff = user?.role === 'hr_staff';
  return { isHrStaff, mode: isHrStaff ? readMode() : null };
}
