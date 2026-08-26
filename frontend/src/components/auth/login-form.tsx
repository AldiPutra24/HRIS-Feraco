'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/auth/auth-provider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Icons } from '@/components/icons';
import { Alert, AlertDescription } from '@/components/ui/alert';

export function LoginForm() {
  const { login, error, clearError } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const returnUrl = searchParams.get('returnUrl') || '/dashboard';

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    clearError();
    setIsLoading(true);

    try {
      await login({ email, password, rememberMe });
      router.replace(returnUrl);
    } catch {
      // error is surfaced by auth provider
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className='w-full max-w-sm space-y-4'>
      <div className='space-y-2 text-center'>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src='/logo.webp' alt='Logo HRIS' className='mx-auto h-16 w-16 object-contain' />
        <h1 className='text-2xl font-semibold tracking-tight'>Sign in</h1>
        <p className='text-muted-foreground text-sm'>Enter your credentials to access the dashboard.</p>
      </div>

      {error && (
        <Alert variant='destructive'>
          <Icons.alertCircle className='h-4 w-4' />
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      )}

      <div className='space-y-2'>
        <Label htmlFor='email'>Email</Label>
        <Input
          id='email'
          type='email'
          placeholder='name@company.com'
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={isLoading}
          required
        />
      </div>

      <div className='space-y-2'>
        <Label htmlFor='password'>Password</Label>
        <div className='relative'>
          <Input
            id='password'
            type={showPassword ? 'text' : 'password'}
            placeholder='••••••••'
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={isLoading}
            required
          />
          <button
            type='button'
            onClick={() => setShowPassword((prev) => !prev)}
            className='text-muted-foreground absolute inset-y-0 right-2 flex items-center px-2 hover:text-foreground'
            aria-label={showPassword ? 'Hide password' : 'Show password'}
          >
            {showPassword ? <Icons.eyeOff className='h-4 w-4' /> : <Icons.eye className='h-4 w-4' />}
          </button>
        </div>
      </div>

      <div className='flex items-center justify-between'>
        <div className='flex items-center space-x-2'>
          <Checkbox
            id='remember'
            checked={rememberMe}
            onCheckedChange={(checked) => setRememberMe(checked === true)}
            disabled={isLoading}
          />
          <Label htmlFor='remember' className='text-sm font-normal'>
            Remember me
          </Label>
        </div>
      </div>

      <Button type='submit' className='w-full' disabled={isLoading}>
        {isLoading && <Icons.spinner className='mr-2 h-4 w-4 animate-spin' />}
        Sign in
      </Button>
    </form>
  );
}
