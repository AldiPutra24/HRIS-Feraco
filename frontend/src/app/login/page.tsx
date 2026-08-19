import { LoginForm } from '@/components/auth/login-form';
import { Metadata } from 'next';
import { Suspense } from 'react';

export const metadata: Metadata = {
  title: 'Sign In | HRIS',
  description: 'Sign in to the internal HRIS dashboard.'
};

export default function LoginPage() {
  return (
    <main className='bg-background flex min-h-screen flex-col items-center justify-center p-4'>
      <Suspense>
        <LoginForm />
      </Suspense>
    </main>
  );
}
