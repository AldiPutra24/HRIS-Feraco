'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'react-toastify';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  approveReimbursement,
  deleteReimbursement,
  listReimbursementCategories,
  listReimbursements,
  markReimbursementPaid,
  rejectReimbursement,
  type Reimbursement,
  type ReimbursementCategory
} from '@/lib/reimbursements';
import { listEmployees, type Employee } from '@/lib/employees';
import { useAuth } from '@/lib/auth/auth-provider';

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  DRAFT: 'outline',
  PENDING: 'secondary',
  APPROVED: 'default',
  REJECTED: 'destructive',
  PAID: 'default',
  CANCELLED: 'outline'
};

const STATUS_OPTIONS = ['DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'PAID', 'CANCELLED'];

function StatusBadge({ status }: { status: string }) {
  return <Badge variant={STATUS_VARIANT[status] ?? 'secondary'}>{status}</Badge>;
}

function formatAmount(n: number): string {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR' }).format(n);
}

export function ReimbursementPage() {
  const router = useRouter();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const searchParams = useSearchParams();
  const fStatus = searchParams.get('status') ?? '';
  const fCategory = searchParams.get('category') ?? '';
  const fEmployee = searchParams.get('employee') ?? '';

  function setFilter(key: string, value: string) {
    const params = new URLSearchParams(searchParams);
    if (value) params.set(key, value);
    else params.delete(key);
    router.replace(`/dashboard/reimbursements${params.size ? `?${params}` : ''}`);
  }

  const [items, setItems] = useState<Reimbursement[]>([]);
  const [categories, setCategories] = useState<ReimbursementCategory[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [approving, setApproving] = useState<Reimbursement | null>(null);
  const [approveAmount, setApproveAmount] = useState('');
  const [rejecting, setRejecting] = useState<Reimbursement | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [paying, setPaying] = useState<Reimbursement | null>(null);
  const [paymentRef, setPaymentRef] = useState('');
  const [paymentFile, setPaymentFile] = useState<File | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const params: Record<string, string> = {};
    if (fStatus) params.status = fStatus;
    if (fCategory) params.category = fCategory;
    if (fEmployee) params.employee = fEmployee;
    const [r, c] = await Promise.all([listReimbursements(params), listReimbursementCategories()]);
    setItems(r);
    setCategories(c);
    setLoading(false);
  }, [fStatus, fCategory, fEmployee]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    listEmployees({ employment_status: 'ACTIVE', page_size: '1000' })
      .then((d) => setEmployees(d.results))
      .catch(() => {});
  }, []);

  async function approve(r: Reimbursement) {
    setApproving(r);
    setApproveAmount(r.amount != null ? String(r.amount) : '');
  }

  async function confirmApprove() {
    if (!approving) return;
    const val = Number(approveAmount);
    if (!approveAmount.trim() || !val || val <= 0) {
      toast.error('Nominal disetujui wajib diisi dan lebih dari 0.');
      return;
    }
    if (val > approving.amount) {
      toast.error('Nominal disetujui tidak boleh melebihi nominal diajukan.');
      return;
    }
    try {
      await approveReimbursement(approving.id, val);
      toast.success('Reimbursement disetujui.');
      setApproving(null);
      setApproveAmount('');
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal menyetujui.');
    }
  }

  async function confirmReject() {
    if (!rejecting) return;
    if (!rejectReason.trim()) {
      toast.error('Alasan penolakan wajib diisi.');
      return;
    }
    try {
      await rejectReimbursement(rejecting.id, rejectReason.trim());
      toast.success('Reimbursement ditolak.');
      setRejecting(null);
      setRejectReason('');
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal menolak.');
    }
  }

  async function confirmPaid() {
    if (!paying) return;
    try {
      await markReimbursementPaid(paying.id, paymentRef.trim(), paymentFile ?? undefined);
      toast.success('Reimbursement ditandai dibayar.');
      setPaying(null);
      setPaymentRef('');
      setPaymentFile(null);
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal menandai dibayar.');
    }
  }

  async function handleDelete(r: Reimbursement) {
    if (!window.confirm(`Hapus reimbursement ${r.employee_name} (${r.category_name})? Tindakan ini permanen.`)) return;
    try {
      await deleteReimbursement(r.id);
      toast.success('Data reimbursement dihapus.');
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal menghapus.');
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
      <div>
        <h2 className='text-2xl font-bold tracking-tight'>Reimbursement</h2>
        <p className='text-muted-foreground text-sm'>Kelola pengajuan reimbursement karyawan.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filter</CardTitle>
        </CardHeader>
        <CardContent>
          <div className='grid grid-cols-1 gap-3 md:grid-cols-4'>
            <div>
              <Label className='text-xs'>Status</Label>
              <select
                className='border-input h-9 w-full rounded-lg border bg-transparent px-2.5 text-sm'
                value={fStatus}
                onChange={(e) => setFilter('status', e.target.value)}
              >
                <option value=''>Semua status</option>
                {STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label className='text-xs'>Kategori</Label>
              <select
                className='border-input h-9 w-full rounded-lg border bg-transparent px-2.5 text-sm'
                value={fCategory}
                onChange={(e) => setFilter('category', e.target.value)}
              >
                <option value=''>Semua kategori</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label className='text-xs'>Karyawan</Label>
              <select
                className='border-input h-9 w-full rounded-lg border bg-transparent px-2.5 text-sm'
                value={fEmployee}
                onChange={(e) => setFilter('employee', e.target.value)}
              >
                <option value=''>Semua karyawan</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.full_name}
                  </option>
                ))}
              </select>
            </div>
            <div className='flex items-end'>
              <Button variant='ghost' onClick={() => router.replace('/dashboard/reimbursements')}>
                Reset
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Daftar Pengajuan</CardTitle>
        </CardHeader>
        <CardContent className='p-0'>
          {items.length === 0 ? (
            <p className='text-muted-foreground p-6 text-center'>Belum ada pengajuan.</p>
          ) : (
            <div className='overflow-x-auto'>
              <table className='w-full text-sm'>
                <TableHeader>
                  <TableRow>
                    <TableHead>Karyawan</TableHead>
                    <TableHead>Kategori</TableHead>
                    <TableHead>Kategori Project</TableHead>
                    <TableHead>Tanggal</TableHead>
                    <TableHead className='text-right'>Nominal Diajukan</TableHead>
                    <TableHead className='text-right'>Nominal Disetujui</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Lampiran</TableHead>
                    <TableHead>Bukti Transfer</TableHead>
                    <TableHead className='sticky right-0 bg-background text-right shadow-[inset_1px_0_0_var(--color-border)]'>
                      Aksi
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>{r.employee_name}</TableCell>
                      <TableCell>{r.category_name}</TableCell>
                      <TableCell>{r.project_category === 'OTHER' ? r.project_category_other : r.project_category.replace(/_/g, ' ')}</TableCell>
                      <TableCell>{r.transaction_date}</TableCell>
                      <TableCell className='text-right'>{formatAmount(r.amount)}</TableCell>
                      <TableCell className='text-right'>{r.approved_amount != null ? formatAmount(r.approved_amount) : '-'}</TableCell>
                      <TableCell>
                        <StatusBadge status={r.status} />
                      </TableCell>
                      <TableCell>
                        {r.attachment_url ? (
                          <a href={r.attachment_url} target='_blank' rel='noreferrer' className='text-primary underline'>
                            {r.attachment_name}
                          </a>
                        ) : (
                          <span className='text-muted-foreground'>-</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {r.payment_proof_url ? (
                          <a href={r.payment_proof_url} target='_blank' rel='noreferrer' className='text-primary underline'>
                            {r.payment_proof_name || 'Lihat bukti'}
                          </a>
                        ) : (
                          <span className='text-muted-foreground'>-</span>
                        )}
                      </TableCell>
                      <TableCell className='sticky right-0 bg-background text-right shadow-[inset_1px_0_0_var(--color-border)]'>
                        <div className='flex justify-end gap-1'>
                          {r.status === 'PENDING' && (
                            <>
                              <Button size='sm' onClick={() => approve(r)}>
                                Setujui
                              </Button>
                              <Button size='sm' variant='destructive' onClick={() => setRejecting(r)}>
                                Tolak
                              </Button>
                            </>
                          )}
                          {r.status === 'APPROVED' && (
                            <Button size='sm' onClick={() => setPaying(r)}>
                              Tandai Dibayar
                            </Button>
                          )}
                          {r.status === 'REJECTED' && r.rejection_reason && (
                            <span className='text-muted-foreground text-xs'>{r.rejection_reason}</span>
                          )}
                          {r.status === 'PAID' && r.payment_reference && (
                            <span className='text-muted-foreground text-xs'>Ref: {r.payment_reference}</span>
                          )}
                          {isAdmin && (
                            <Button size='sm' variant='ghost' onClick={() => handleDelete(r)}>
                              Hapus
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

      {approving && (
        <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4'>
          <Card className='w-full max-w-md'>
            <CardHeader>
              <CardTitle>Setujui Reimbursement</CardTitle>
            </CardHeader>
            <CardContent>
              <div className='space-y-3'>
                <p className='text-sm text-muted-foreground'>
                  {approving.employee_name} — {approving.category_name} ({formatAmount(approving.amount)})
                </p>
                <div>
                  <Label className='text-xs'>Nominal Disetujui (IDR)</Label>
                  <Input
                    type='number'
                    min='0'
                    step='0.01'
                    placeholder='Nominal disetujui'
                    value={approveAmount}
                    onChange={(e) => setApproveAmount(e.target.value)}
                  />
                </div>
                <div className='flex justify-end gap-2'>
                  <Button
                    variant='ghost'
                    onClick={() => {
                      setApproving(null);
                      setApproveAmount('');
                    }}
                  >
                    Batal
                  </Button>
                  <Button onClick={confirmApprove}>Setujui</Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {rejecting && (
        <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4'>
          <Card className='w-full max-w-md'>
            <CardHeader>
              <CardTitle>Tolak Reimbursement</CardTitle>
            </CardHeader>
            <CardContent>
              <div className='space-y-3'>
                <p className='text-sm text-muted-foreground'>
                  {rejecting.employee_name} — {rejecting.category_name} ({formatAmount(rejecting.amount)})
                </p>
                <Label className='text-xs'>Alasan Penolakan</Label>
                <Input
                  placeholder='Alasan wajib diisi'
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                />
                <div className='flex justify-end gap-2'>
                  <Button variant='ghost' onClick={() => setRejecting(null)}>
                    Batal
                  </Button>
                  <Button variant='destructive' onClick={confirmReject}>
                    Tolak
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {paying && (
        <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4'>
          <Card className='w-full max-w-md'>
            <CardHeader>
              <CardTitle>Tandai Dibayar</CardTitle>
            </CardHeader>
            <CardContent>
              <div className='space-y-3'>
                <p className='text-sm text-muted-foreground'>
                  {paying.employee_name} — {paying.category_name} ({formatAmount(paying.amount)})
                </p>
                <Label className='text-xs'>Referensi Pembayaran</Label>
                <Input
                  placeholder='Misal: TRF/2026/08/001'
                  value={paymentRef}
                  onChange={(e) => setPaymentRef(e.target.value)}
                />
                <Label className='text-xs'>Bukti Transfer (opsional)</Label>
                <Input
                  type='file'
                  accept='image/*,application/pdf'
                  onChange={(e) => setPaymentFile(e.target.files?.[0] ?? null)}
                />
                <div className='flex justify-end gap-2'>
                  <Button
                    variant='ghost'
                    onClick={() => {
                      setPaying(null);
                      setPaymentRef('');
                      setPaymentFile(null);
                    }}
                  >
                    Batal
                  </Button>
                  <Button onClick={confirmPaid}>Konfirmasi</Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
