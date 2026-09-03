'use client';

import { getOnboarding, onboardingStatusLabel, onboardingStatusVariant, transitionOnboarding, type Onboarding } from '@/lib/onboarding';
import { useAuth } from '@/lib/auth/auth-provider';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'react-toastify';
import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';

const HR_ROLES = new Set(['admin', 'hr_staff', 'hr_lead']);

export function OnboardingDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const [item, setItem] = useState<Onboarding | null>(null);
  const [loading, setLoading] = useState(true);

  const canManage = user?.role ? HR_ROLES.has(user.role) : false;

  const load = useCallback(async () => {
    try {
      const data = await getOnboarding(Number(id));
      setItem(data);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal memuat data onboarding.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleTransition(status: string) {
    try {
      await transitionOnboarding(Number(id), status);
      toast.success(`Status diubah ke ${onboardingStatusLabel(status)}.`);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal mengubah status.');
    }
  }

  if (loading) {
    return (
      <div className='space-y-2 p-4 md:p-6'>
        <Skeleton className='h-8 w-48' />
        <Skeleton className='h-24 w-full' />
        <Skeleton className='h-48 w-full' />
      </div>
    );
  }

  if (!item) {
    return (
      <div className='flex flex-1 flex-col items-center justify-center gap-3 p-4 md:p-6'>
        <p className='text-muted-foreground'>Onboarding tidak ditemukan.</p>
        <Button variant='ghost' onClick={() => router.back()}>
          Kembali
        </Button>
      </div>
    );
  }

  return (
    <div className='flex flex-1 flex-col gap-4 p-4 md:p-6'>
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <div>
          <h2 className='text-2xl font-bold tracking-tight'>{item.candidate_name}</h2>
          <p className='text-muted-foreground text-sm'>{item.job_title}</p>
        </div>
        <div className='flex items-center gap-2'>
          <Badge variant={onboardingStatusVariant(item.status)} className='text-sm'>
            {onboardingStatusLabel(item.status)}
          </Badge>
          <Button variant='ghost' onClick={() => router.back()}>
            Kembali
          </Button>
        </div>
      </div>

      <div className='grid grid-cols-1 gap-4 md:grid-cols-3'>
        <Card>
          <CardHeader>
            <CardTitle className='text-base'>Detail Kandidat</CardTitle>
          </CardHeader>
          <CardContent className='space-y-2 text-sm'>
            <div className='flex justify-between'>
              <span className='text-muted-foreground'>Nama</span>
              <span>{item.candidate_name}</span>
            </div>
            <div className='flex justify-between'>
              <span className='text-muted-foreground'>Posisi</span>
              <span>{item.job_title}</span>
            </div>
            <div className='flex justify-between'>
              <span className='text-muted-foreground'>Department</span>
              <span>{item.department_name}</span>
            </div>
            <div className='flex justify-between'>
              <span className='text-muted-foreground'>Posisi</span>
              <span>{item.position_name}</span>
            </div>
            <div className='flex justify-between'>
              <span className='text-muted-foreground'>Target Join</span>
              <span>{item.target_join_date || '-'}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className='text-base'>Status Pipeline</CardTitle>
          </CardHeader>
          <CardContent className='space-y-2 text-sm'>
            <div className='flex justify-between'>
              <span className='text-muted-foreground'>Status</span>
              <Badge variant={onboardingStatusVariant(item.status)}>
                {onboardingStatusLabel(item.status)}
              </Badge>
            </div>
            <div className='flex justify-between'>
              <span className='text-muted-foreground'>Dibuat oleh</span>
              <span>{item.created_by_name}</span>
            </div>
            <div className='flex justify-between'>
              <span className='text-muted-foreground'>Dibuat</span>
              <span>{item.created_at}</span>
            </div>
            {item.completed_at && (
              <div className='flex justify-between'>
                <span className='text-muted-foreground'>Selesai</span>
                <span>{item.completed_at}</span>
              </div>
            )}
          </CardContent>
        </Card>

        {canManage && item.next_statuses.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className='text-base'>Aksi</CardTitle>
              <CardDescription>Transisi yang tersedia</CardDescription>
            </CardHeader>
            <CardContent className='flex flex-wrap gap-2'>
              {item.next_statuses.map((s) => (
                <Button
                  key={s}
                  size='sm'
                  variant={s === 'CANCELLED' ? 'destructive' : 'default'}
                  onClick={() => handleTransition(s)}
                >
                  {onboardingStatusLabel(s)}
                </Button>
              ))}
            </CardContent>
          </Card>
        )}
      </div>

      {item.status_history.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className='text-base'>Riwayat Status</CardTitle>
          </CardHeader>
          <CardContent className='p-0'>
            <div className='overflow-x-auto'>
              <table className='w-full text-sm'>
                <TableHeader>
                  <TableRow>
                    <TableHead>Status</TableHead>
                    <TableHead>Diubah oleh</TableHead>
                    <TableHead>Catatan</TableHead>
                    <TableHead>Waktu</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {item.status_history.map((h, i) => (
                    <TableRow key={i}>
                      <TableCell>
                        <Badge variant={onboardingStatusVariant(h.to_status)}>
                          {onboardingStatusLabel(h.to_status)}
                        </Badge>
                      </TableCell>
                      <TableCell>{h.changed_by_name}</TableCell>
                      <TableCell>{h.note || '-'}</TableCell>
                      <TableCell>{h.changed_at}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}