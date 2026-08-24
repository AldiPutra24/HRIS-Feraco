'use client';

import { useAuth } from '@/lib/auth/auth-provider';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

export default function Dashboard() {
  const { user, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (isLoading) return;
    router.replace(user?.role === 'employee' ? '/dashboard/employee' : '/dashboard/overview');
  }, [isLoading, user, router]);

  return null;
}
