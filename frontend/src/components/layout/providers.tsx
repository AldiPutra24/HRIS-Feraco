'use client';
import React from 'react';
import { ToastContainer } from 'react-toastify';
import { AuthProvider } from '@/lib/auth/auth-provider';
import QueryProvider from './query-provider';
import 'react-toastify/dist/ReactToastify.css';

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AuthProvider>
        <QueryProvider>{children}</QueryProvider>
      </AuthProvider>
      <ToastContainer position='bottom-right' autoClose={3000} />
    </>
  );
}
