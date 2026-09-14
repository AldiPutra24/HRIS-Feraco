'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Icons } from '@/components/icons';
import { useAuth } from '@/lib/auth/auth-provider';
import { readMode, writeMode, type DashboardMode } from '@/lib/auth/dashboard-mode';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

const OPTIONS: {
  mode: DashboardMode;
  title: string;
  description: string;
  icon: keyof typeof Icons;
  href: string;
}[] = [
  {
    mode: 'hris',
    title: 'Dashboard HRIS',
    description: 'Kelola karyawan, izin & cuti, reimbursement, recruitment, payroll, dan lainnya.',
    icon: 'dashboard',
    href: '/dashboard/overview'
  },
  {
    mode: 'employee',
    title: 'Dashboard Karyawan',
    description: 'Lihat data Anda sendiri: profil, izin & cuti, reimbursement, dan kontrak.',
    icon: 'employee',
    href: '/dashboard/employee'
  }
];

export default function PilihDashboardPage() {
  const { user, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (isLoading) return;
    if (!user) {
      router.replace('/login');
      return;
    }
    if (user.role !== 'hr_staff') {
      router.replace('/dashboard');
      return;
    }
    // Already chosen before: skip selector.
    const stored = readMode();
    if (stored) router.replace(stored === 'hris' ? '/dashboard/overview' : '/dashboard/employee');
  }, [isLoading, user, router]);

  function choose(mode: DashboardMode) {
    writeMode(mode);
    router.push(mode === 'hris' ? '/dashboard/overview' : '/dashboard/employee');
  }

  return (
    <div className='flex min-h-screen flex-col items-center justify-center gap-8 p-4'>
      <div className='text-center'>
        <h1 className='text-2xl font-bold tracking-tight'>Pilih Dashboard</h1>
        <p className='text-muted-foreground mt-1 text-sm'>
          Halo {user?.name ?? ''}, pilih mode dashboard yang ingin Anda gunakan.
        </p>
      </div>
      <div className='grid w-full max-w-2xl grid-cols-1 gap-4 sm:grid-cols-2'>
        {OPTIONS.map((opt) => {
          const Icon = Icons[opt.icon];
          return (
            <Card key={opt.mode} className='flex flex-col'>
              <CardHeader>
                <div className='bg-primary/10 text-primary flex size-10 items-center justify-center rounded-lg'>
                  <Icon className='size-5' />
                </div>
                <CardTitle className='mt-2'>{opt.title}</CardTitle>
                <CardDescription>{opt.description}</CardDescription>
              </CardHeader>
              <CardContent className='mt-auto'>
                <Button className='w-full' onClick={() => choose(opt.mode)}>
                  Masuk
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
