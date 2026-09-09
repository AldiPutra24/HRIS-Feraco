'use client';

import { useAuth } from '@/lib/auth/auth-provider';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

export default function Dashboard() {
  const { user, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (isLoading) return;
    if (user?.role === 'employee') router.replace('/dashboard/employee');
    else if (user?.role === 'management') router.replace('/dashboard/management/overview');
    else router.replace('/dashboard/overview');
  }, [isLoading, user, router]);

  return null;
}
