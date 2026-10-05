'use client';

import { useAuth } from '@/lib/auth/auth-provider';
import { hasDualMode, readMode } from '@/lib/auth/dashboard-mode';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect } from 'react';

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, isAuthenticated, isLoading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  const redirectToLogin = useCallback(() => {
    const returnUrl = encodeURIComponent(pathname);
    router.replace(`/login?returnUrl=${returnUrl}`);
  }, [router, pathname]);

  useEffect(() => {
    if (isLoading || !isAuthenticated) return;
    // Route guard by role: employees live under /dashboard/employee (KMS is
    // accessible to every role, per spec).
    if (
      user?.role === 'employee' &&
      !pathname.startsWith('/dashboard/employee') &&
      !pathname.startsWith('/kms')
    ) {
      router.replace('/dashboard/employee');
      return;
    }
    // HR Staff / HR Lead in employee mode may browse their own /dashboard/employee/*.
    if (hasDualMode(user?.role) && pathname.startsWith('/dashboard/employee')) {
      if (readMode() !== 'employee') router.replace('/dashboard/pilih');
      return;
    }
    if (user && user.role !== 'employee' && user.role !== 'general_manager' && pathname.startsWith('/dashboard/employee')) {
      router.replace('/dashboard/overview');
    }
  }, [isLoading, isAuthenticated, user, router, pathname]);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      redirectToLogin();
    }
  }, [isLoading, isAuthenticated, redirectToLogin]);

  if (isLoading || !isAuthenticated) {
    return (
      <div className='flex h-screen w-full items-center justify-center'>
        <div className='border-primary h-8 w-8 animate-spin rounded-full border-2 border-t-transparent' />
      </div>
    );
  }

  return <>{children}</>;
}
