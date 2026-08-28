'use client';

import { useAuth } from '@/lib/auth/auth-provider';
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
    // Route guard by role: employees live under /dashboard/employee only.
    if (user?.role === 'employee' && !pathname.startsWith('/dashboard/employee')) {
      router.replace('/dashboard/employee');
      return;
    }
    if (user && user.role !== 'employee' && pathname.startsWith('/dashboard/employee')) {
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
