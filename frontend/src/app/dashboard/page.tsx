'use client';

import { useAuth } from '@/lib/auth/auth-provider';
import { readMode } from '@/lib/auth/dashboard-mode';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

export default function Dashboard() {
  const { user, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (isLoading) return;
    if (user?.role === 'employee') router.replace('/dashboard/employee');
    else if (user?.role === 'management' || user?.role === 'general_manager') router.replace('/dashboard/management/overview');
    else if (user?.role === 'hr_staff') {
      const mode = readMode();
      if (mode === 'hris') router.replace('/dashboard/overview');
      else if (mode === 'employee') router.replace('/dashboard/employee');
      else router.replace('/dashboard/pilih');
    } else router.replace('/dashboard/overview');
  }, [isLoading, user, router]);

  return null;
}
