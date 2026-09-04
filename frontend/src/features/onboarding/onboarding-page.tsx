'use client';

import {
  createOnboarding,
  listOnboarding,
  hardDeleteOnboarding,
  onboardingStatusLabel,
  onboardingStatusVariant,
  transitionOnboarding,
  type Onboarding
} from '@/lib/onboarding';
import { listCandidates, type Candidate } from '@/lib/recruitment';
import { useAuth } from '@/lib/auth/auth-provider';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

const HR_ROLES = new Set(['admin', 'hr_staff', 'hr_lead']);

export function OnboardingPage() {
  const { user } = useAuth();
  const router = useRouter();
  const [items, setItems] = useState<Onboarding[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [fStatus, setFStatus] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [selected, setSelected] = useState('');
  const [targetJoin, setTargetJoin] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const canManage = user?.role ? HR_ROLES.has(user.role) : false;
  const isAdmin = user?.role === 'admin';

  const load = useCallback(async () => {
    try {
      const data = await listOnboarding();
      setItems(data);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal memuat data onboarding.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!createOpen) return;
    listCandidates({ status: 'OFFER_ACCEPTED' })
      .then(setCandidates)
      .catch(() => toast.error('Gagal memuat kandidat yang memenuhi syarat.'));
  }, [createOpen]);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    return items.filter((o) => {
      const matchesQ =
        !query ||
        o.candidate_name.toLowerCase().includes(query) ||
        o.job_title.toLowerCase().includes(query);
      const matchesStatus = !fStatus || o.status === fStatus;
      return matchesQ && matchesStatus;
    });
  }, [items, q, fStatus]);

  async function handleCreate() {
    if (!selected) {
      toast.error('Pilih kandidat terlebih dahulu.');
      return;
    }
    if (!targetJoin) {
      toast.error('Target tanggal bergabung wajib diisi.');
      return;
    }
    setSubmitting(true);
    try {
      const created = await createOnboarding({
        candidate: Number(selected),
        target_join_date: targetJoin,
        notes: notes || undefined,
      });
      toast.success('Onboarding dibuat.');
      setCreateOpen(false);
      setSelected('');
      setTargetJoin('');
      setNotes('');
      router.push(`/dashboard/recruitment/onboarding/${created.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal membuat onboarding.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleTransition(o: Onboarding, status: string) {
    try {
      await transitionOnboarding(o.id, status);
      toast.success(`Status diubah ke ${onboardingStatusLabel(status)}.`);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal mengubah status.');
    }
  }

  async function handleDelete(o: Onboarding) {
    if (!window.confirm(`Hapus permanen onboarding "${o.candidate_name}"? Tidak dapat dibatalkan.`)) return;
    try {
      await hardDeleteOnboarding(o.id);
      toast.success('Onboarding dihapus permanen.');
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal menghapus onboarding.');
    }
  }

  if (loading) {
    return (
      <div className='space-y-2 p-4 md:p-6'>
        <Skeleton className='h-8 w-64' />
        <Skeleton className='h-40 w-full' />
      </div>
    );
  }

  return (
    <div className='flex flex-1 flex-col gap-4 p-4 md:p-6'>
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <div>
          <h2 className='text-2xl font-bold tracking-tight'>Onboarding</h2>
          <p className='text-muted-foreground text-sm'>Proses onboarding kandidat yang telah menerima tawaran.</p>
        </div>
        {canManage && (
          <Button onClick={() => setCreateOpen(true)}>Buat Onboarding</Button>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filter</CardTitle>
        </CardHeader>
        <CardContent>
          <div className='grid grid-cols-1 gap-3 md:grid-cols-3'>
            <div>
              <Label className='text-xs'>Cari</Label>
              <Input placeholder='Nama kandidat atau posisi' value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <div>
              <Label className='text-xs'>Status</Label>
              <select
                className='border-input h-9 w-full rounded-lg border bg-transparent px-2.5 text-sm'
                value={fStatus}
                onChange={(e) => setFStatus(e.target.value)}
              >
                <option value=''>Semua status</option>
                {['PENDING', 'IN_PROGRESS', 'DOCUMENT_REVIEW', 'READY', 'COMPLETED', 'CANCELLED'].map((s) => (
                  <option key={s} value={s}>
                    {onboardingStatusLabel(s)}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Daftar Onboarding</CardTitle>
        </CardHeader>
        <CardContent className='p-0'>
          {filtered.length === 0 ? (
            <p className='text-muted-foreground p-6 text-center'>Belum ada onboarding.</p>
          ) : (
            <div className='overflow-x-auto'>
              <table className='w-full min-w-[960px] text-sm'>
                <TableHeader>
                  <TableRow>
                    <TableHead>Kandidat</TableHead>
                    <TableHead>Posisi</TableHead>
                    <TableHead>Target Join</TableHead>
                    <TableHead>Dibuat</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className='sticky right-0 bg-background text-right shadow-[inset_1px_0_0_var(--color-border)]'>
                      Aksi
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((o) => (
                    <TableRow key={o.id}>
                      <TableCell className='font-medium'>{o.candidate_name}</TableCell>
                      <TableCell>{o.job_title}</TableCell>
                      <TableCell>{o.target_join_date || '-'}</TableCell>
                      <TableCell>{o.created_at}</TableCell>
                      <TableCell>
                        <Badge variant={onboardingStatusVariant(o.status)}>{onboardingStatusLabel(o.status)}</Badge>
                      </TableCell>
                      <TableCell className='sticky right-0 bg-background text-right shadow-[inset_1px_0_0_var(--color-border)]'>
                        <div className='flex justify-end gap-1'>
                          {canManage &&
                            o.next_statuses.map((s) => (
                              <Button key={s} size='sm' onClick={() => handleTransition(o, s)}>
                                {onboardingStatusLabel(s)}
                              </Button>
                            ))}
                          {isAdmin && (
                            <Button size='sm' variant='destructive' onClick={() => handleDelete(o)}>
                              Hapus Permanen
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {createOpen && (
        <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4'>
          <Card className='max-h-[90vh] w-full max-w-lg overflow-y-auto'>
            <CardHeader>
              <CardTitle>Buat Onboarding</CardTitle>
            </CardHeader>
            <CardContent>
              <div className='grid grid-cols-1 gap-3'>
                <div>
                  <Label className='text-xs'>Kandidat *</Label>
                  <select
                    className='border-input h-9 w-full rounded-lg border bg-transparent px-2.5 text-sm'
                    value={selected}
                    onChange={(e) => setSelected(e.target.value)}
                  >
                    <option value=''>Pilih kandidat</option>
                    {candidates.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.full_name} — {c.job_title}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label className='text-xs'>Target Tanggal Bergabung *</Label>
                  <Input type='date' required value={targetJoin} onChange={(e) => setTargetJoin(e.target.value)} />
                  <p className='mt-1 text-xs text-muted-foreground'>Wajib diisi — dapat diubah di halaman detail.</p>
                </div>
                <div>
                  <Label className='text-xs'>Catatan</Label>
                  <textarea
                    className='border-input h-20 w-full rounded-lg border bg-transparent px-2.5 py-2 text-sm'
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder='Catatan onboarding (opsional)'
                  />
                </div>
                <div className='flex justify-end gap-2'>
                  <Button variant='ghost' onClick={() => setCreateOpen(false)}>
                    Batal
                  </Button>
                  <Button onClick={handleCreate} disabled={submitting || !selected || !targetJoin}>
                    {submitting ? 'Menyimpan…' : 'Simpan'}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
