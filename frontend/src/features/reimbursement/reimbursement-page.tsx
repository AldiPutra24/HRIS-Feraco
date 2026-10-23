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
import { LinkifiedText } from '@/components/linkified-text';
import { AttachmentCell } from './attachment-cell';
import { Icons } from '@/components/icons';
import {
  approveReimbursement,
  deleteReimbursement,
  exportReimbursementsXlsx,
  getReimbursement,
  getReimbursementSummary,
  listReimbursementCategories,
  listReimbursements,
  markReimbursementPaid,
  rejectReimbursement,
  reviewReimbursement,
  reimbursementStatusLabel,
  type Reimbursement,
  type ReimbursementCategory,
  type ReimbursementSummary
} from '@/lib/reimbursements';
import { listEmployees, type Employee } from '@/lib/employees';
import { useAuth } from '@/lib/auth/auth-provider';

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  DRAFT: 'outline',
  PENDING: 'secondary',
  WAITING_HR_LEAD: 'secondary',
  APPROVED: 'default',
  REJECTED: 'destructive',
  PAID: 'default',
  CANCELLED: 'outline'
};

const STATUS_OPTIONS = ['DRAFT', 'PENDING', 'WAITING_HR_LEAD', 'APPROVED', 'REJECTED', 'PAID', 'CANCELLED'];

function StatusBadge({ r }: { r: Reimbursement }) {
  return <Badge variant={STATUS_VARIANT[r.status] ?? 'secondary'}>{reimbursementStatusLabel(r)}</Badge>;
}

function formatAmount(n: number): string {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR' }).format(n);
}

function formatRupiah(n: number): string {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(n);
}

function KpiCard({
  label,
  value,
  hint,
  icon,
  tone,
  onClick
}: {
  label: string;
  value: string;
  hint: string;
  icon: keyof typeof Icons;
  tone: string;
  onClick?: () => void;
}) {
  const Icon = Icons[icon];
  const body = (
    <CardContent className='flex items-start justify-between gap-3 px-4'>
      <div className='min-w-0'>
        <p className='text-muted-foreground text-xs font-medium'>{label}</p>
        <p className='mt-1 truncate text-2xl font-semibold tracking-tight tabular-nums'>{value}</p>
        <p className='text-muted-foreground mt-0.5 text-xs'>{hint}</p>
      </div>
      <span className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${tone}`}>
        <Icon className='size-4' />
      </span>
    </CardContent>
  );
  return (
    <Card className='gap-0 py-4 transition-colors hover:border-ring/50'>
      {onClick ? (
        <button type='button' onClick={onClick} className='text-left'>
          {body}
        </button>
      ) : (
        body
      )}
    </Card>
  );
}

export function ReimbursementPage() {
  const router = useRouter();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  // MANAGEMENT now uses the self-service page (same flow as Employee); keep
  // direct-URL visitors away from the HR approval view.
  useEffect(() => {
    if (user?.role === 'management' || user?.role === 'general_manager') router.replace('/dashboard/management/reimbursement');
  }, [user, router]);
  const canAct = user?.role !== 'management';
  // Layer 1: HR Staff sets Nominal Disetujui. Layer 2: HR Lead approves payment
  // (General Manager for an HR Lead's own request — backend `can_final_approve`).
  // Admin may act on both; the backend enforces every layer.
  const canReview = user?.role === 'hr_staff' || user?.role === 'admin';
  const canRejectStatus = (r: Reimbursement) =>
    (r.status === 'PENDING' && canReview) || (r.status === 'WAITING_HR_LEAD' && r.can_final_approve);
  const searchParams = useSearchParams();
  const fStatus = searchParams.get('status') ?? '';
  const fCategory = searchParams.get('category') ?? '';
  const fEmployee = searchParams.get('employee') ?? '';
  // Deep link from the notification bell: /dashboard/reimbursements?id=<id>
  const focusId = Number(searchParams.get('id')) || null;

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
  const [focused, setFocused] = useState<Reimbursement | null>(null);
  const [summary, setSummary] = useState<ReimbursementSummary | null>(null);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const params: Record<string, string> = {};
    if (fStatus) params.status = fStatus;
    if (fCategory) params.category = fCategory;
    if (fEmployee) params.employee = fEmployee;
    const [r, c, s] = await Promise.all([
      listReimbursements(params),
      listReimbursementCategories(),
      // KPI: backend scopes to what this user may see (not the list filters).
      getReimbursementSummary(false).catch(() => null)
    ]);
    setItems(r);
    setCategories(c);
    setSummary(s);
    setFocused(focusId ? await getReimbursement(focusId).catch(() => null) : null);
    setLoading(false);
  }, [fStatus, fCategory, fEmployee, focusId]);

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
      await reviewReimbursement(approving.id, val);
      toast.success('Nominal disetujui ditetapkan. Menunggu approval HR Lead.');
      setApproving(null);
      setApproveAmount('');
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal menyetujui.');
    }
  }

  async function finalApprove(r: Reimbursement) {
    const amount = r.approved_amount != null ? formatAmount(r.approved_amount) : '-';
    if (!window.confirm(`Setujui pembayaran reimbursement ${r.employee_name} sebesar ${amount}?`)) return;
    try {
      await approveReimbursement(r.id);
      toast.success('Pembayaran reimbursement disetujui.');
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

  async function handleExport() {
    setExporting(true);
    try {
      const params: Record<string, string> = {};
      if (fStatus) params.status = fStatus;
      if (fCategory) params.category = fCategory;
      if (fEmployee) params.employee = fEmployee;
      await exportReimbursementsXlsx(params);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal export XLSX.');
    } finally {
      setExporting(false);
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
        <p className='text-muted-foreground text-sm'>
          {user?.role === 'management'
            ? 'Reimbursement bawahan langsung Anda (hanya lihat).'
            : 'Kelola pengajuan reimbursement karyawan.'}
        </p>
      </div>

      {summary && (
        <div className='grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4'>
          <KpiCard
            label='Pengajuan Baru / Menunggu Review'
            value={String(summary.counts.PENDING ?? 0)}
            hint='Menunggu review HR Staff'
            icon='clock'
            tone='bg-amber-500/10 text-amber-600 dark:text-amber-400'
            onClick={() => setFilter('status', 'PENDING')}
          />
          <KpiCard
            label='Menunggu Approval HR Lead'
            value={String(summary.counts.WAITING_HR_LEAD ?? 0)}
            hint='Nominal sudah direview'
            icon='badgeCheck'
            tone='bg-sky-500/10 text-sky-600 dark:text-sky-400'
            onClick={() => setFilter('status', 'WAITING_HR_LEAD')}
          />
          <KpiCard
            label='Dibayar Bulan Ini'
            value={String(summary.paid_this_month?.count ?? 0)}
            hint={new Date().toLocaleDateString('id-ID', { month: 'long', year: 'numeric' })}
            icon='circleCheck'
            tone='bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
          />
          <KpiCard
            label='Total Dibayar Bulan Ini'
            value={formatRupiah(Number(summary.paid_this_month?.amount ?? 0))}
            hint='Berdasarkan nominal disetujui'
            icon='wallet'
            tone='bg-violet-500/10 text-violet-600 dark:text-violet-400'
          />
        </div>
      )}

      <Card>
        <CardHeader className='flex flex-row items-center justify-between gap-3 space-y-0'>
          <CardTitle>Filter</CardTitle>
          <Button variant='outline' size='sm' onClick={handleExport} disabled={exporting}>
            <Icons.download className='size-4' />
            {exporting ? 'Mengekspor...' : 'Export XLSX'}
          </Button>
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

      {focused && (
        <Card className='border-primary'>
          <CardHeader>
            <div className='flex items-center justify-between gap-2'>
              <CardTitle>Detail Pengajuan #{focused.id}</CardTitle>
              <Button variant='ghost' size='sm' onClick={() => setFilter('id', '')}>
                Tutup
              </Button>
            </div>
          </CardHeader>
          <CardContent className='space-y-3 text-sm'>
            <div className='grid grid-cols-1 gap-2 md:grid-cols-3'>
              <p>
                <span className='text-muted-foreground'>Karyawan:</span> {focused.employee_name}
              </p>
              <p>
                <span className='text-muted-foreground'>Kategori:</span> {focused.category_name}
              </p>
              <p>
                <span className='text-muted-foreground'>Tanggal:</span> {focused.transaction_date}
              </p>
              <p>
                <span className='text-muted-foreground'>Nominal:</span> {formatAmount(focused.amount)}
              </p>
              <p>
                <span className='text-muted-foreground'>Status:</span> <StatusBadge r={focused} />
              </p>
              <p>
                <span className='text-muted-foreground'>Nominal disetujui:</span>{' '}
                {focused.approved_amount != null ? formatAmount(focused.approved_amount) : '-'}
                {focused.amount_set_by_name ? ` (oleh ${focused.amount_set_by_name})` : ''}
              </p>
              <p>
                <span className='text-muted-foreground'>Rekening:</span>{' '}
                {focused.bank_name
                  ? `${focused.bank_name} ${focused.bank_account_number} a.n. ${focused.bank_account_name}`
                  : '-'}
              </p>
              <p>
                <span className='text-muted-foreground'>Email:</span> {focused.contact_email || '-'}
              </p>
              <p>
                <span className='text-muted-foreground'>Bukti Payment/Invoice:</span>{' '}
                <AttachmentCell r={focused} />
              </p>
            </div>
            {focused.description && (
              <p className='text-muted-foreground whitespace-pre-wrap break-words'>
                <LinkifiedText text={focused.description} />
              </p>
            )}
            {canAct && canRejectStatus(focused) && (
              <div className='flex gap-2'>
                {focused.status === 'PENDING' ? (
                  <Button variant='success' size='sm' onClick={() => approve(focused)}>
                    Review Nominal
                  </Button>
                ) : (
                  <Button variant='success' size='sm' onClick={() => finalApprove(focused)}>
                    Setujui Pembayaran
                  </Button>
                )}
                <Button variant='destructive' size='sm' onClick={() => setRejecting(focused)}>
                  Tolak
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Daftar Pengajuan</CardTitle>
        </CardHeader>
        <CardContent className='p-0'>
          {items.length === 0 ? (
            <p className='text-muted-foreground p-6 text-center'>Belum ada pengajuan.</p>
          ) : (
            <div className='overflow-x-auto'>
              <table className='w-full min-w-[1120px] text-sm'>
                <TableHeader>
                  <TableRow>
                    <TableHead>Karyawan</TableHead>
                    <TableHead>Kategori</TableHead>
                    <TableHead>Kategori Project</TableHead>
                    <TableHead>Deskripsi</TableHead>
                    <TableHead>Tanggal</TableHead>
                    <TableHead className='text-right'>Nominal Diajukan</TableHead>
                    <TableHead className='text-right'>Nominal Disetujui</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Rekening</TableHead>
                    <TableHead>Bukti Payment/Invoice</TableHead>
                    <TableHead>Bukti Transfer</TableHead>
                    <TableHead className='sticky right-0 bg-background text-right shadow-[inset_1px_0_0_var(--color-border)]'>
                      Aksi
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((r) => (
                    <TableRow key={r.id} className={r.id === focusId ? 'bg-primary/5' : undefined}>
                      <TableCell>{r.employee_name}</TableCell>
                      <TableCell>{r.category_name}</TableCell>
                      <TableCell>{r.project_category === 'OTHER' ? r.project_category_other : r.project_category.replace(/_/g, ' ')}</TableCell>
                      <TableCell className='max-w-64 min-w-40 whitespace-normal break-words text-xs' title={r.description || undefined}>
                        {r.description ? (
                          <LinkifiedText text={r.description} className='line-clamp-3' />
                        ) : (
                          <span className='text-muted-foreground'>-</span>
                        )}
                      </TableCell>
                      <TableCell>{r.transaction_date}</TableCell>
                      <TableCell className='text-right'>{formatAmount(r.amount)}</TableCell>
                      <TableCell className='text-right'>{r.approved_amount != null ? formatAmount(r.approved_amount) : '-'}</TableCell>
                      <TableCell>
                        <StatusBadge r={r} />
                      </TableCell>
                      <TableCell className='text-xs'>
                        {r.bank_name ? (
                          <>
                            {r.bank_name} {r.bank_account_number}
                            <br />
                            a.n. {r.bank_account_name}
                            {r.contact_email && (
                              <>
                                <br />
                                {r.contact_email}
                              </>
                            )}
                          </>
                        ) : (
                          <span className='text-muted-foreground'>-</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <AttachmentCell r={r} />
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
                          {canAct && canRejectStatus(r) && (
                            <>
                              {r.status === 'PENDING' ? (
                                <Button variant='success' size='sm' onClick={() => approve(r)}>
                                  Review Nominal
                                </Button>
                              ) : (
                                <Button variant='success' size='sm' onClick={() => finalApprove(r)}>
                                  Setujui Pembayaran
                                </Button>
                              )}
                              <Button variant='destructive' size='sm' onClick={() => setRejecting(r)}>
                                Tolak
                              </Button>
                            </>
                          )}
                          {canAct && r.status === 'APPROVED' && (
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
                          {isAdmin && canAct && (
                            <Button variant='destructive' size='sm' onClick={() => handleDelete(r)}>
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
              <CardTitle>Review — Tetapkan Nominal Disetujui</CardTitle>
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
                  <Button onClick={confirmApprove}>Simpan &amp; Teruskan ke HR Lead</Button>
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
