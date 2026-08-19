'use client';
import React from 'react';
import { AuthProvider } from '@/lib/auth/auth-provider';
import QueryProvider from './query-provider';

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AuthProvider>
        <QueryProvider>{children}</QueryProvider>
      </AuthProvider>
    </>
  );
}
