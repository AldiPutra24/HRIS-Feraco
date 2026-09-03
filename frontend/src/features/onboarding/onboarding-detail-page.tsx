'use client';

import {
  getOnboarding,
  onboardingStatusLabel,
  onboardingStatusVariant,
  transitionOnboarding,
  completeOnboarding,
  getOnboardingData,
  updateOnboardingData,
  listChecklist,
  updateChecklistItem,
  listDocuments,
  uploadDocument,
  updateDocument,
  deleteDocument,
  getReadiness,
  type Onboarding,
  type OnboardingData,
  type OnboardingChecklistItem,
  type OnboardingDocument,
  type OnboardingReadiness,
} from '@/lib/onboarding';
import { useAuth } from '@/lib/auth/auth-provider';
import { Icons } from '@/components/icons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'react-toastify';
import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
// Select — native <select> styled with Tailwind
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

const HR_ROLES = new Set(['admin', 'hr_staff', 'hr_lead']);
const TABS = ['Data', 'Checklist', 'Documents', 'Summary'] as const;
type Tab = (typeof TABS)[number];

const DOC_TYPE_OPTIONS = [
  { value: 'KTP', label: 'KTP' },
  { value: 'KK', label: 'KK' },
  { value: 'NPWP', label: 'NPWP' },
  { value: 'BPJS_KESEHATAN', label: 'BPJS Kesehatan' },
  { value: 'BPJS_KETENAGAKERJAAN', label: 'BPJS Ketenagakerjaan' },
  { value: 'BUKU_REKENING', label: 'Buku Rekening' },
  { value: 'IJAZAH', label: 'Ijazah' },
  { value: 'KONTRAK_KERJA', label: 'Kontrak Kerja' },
  { value: 'LAINNYA', label: 'Lainnya' },
];

function docStatusVariant(s: string): 'default' | 'secondary' | 'outline' | 'destructive' {
  if (s === 'APPROVED') return 'secondary';
  if (s === 'REJECTED') return 'destructive';
  return 'default';
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

// ── Tab: Data ────────────────────────────────────────────────────────

function DataTab({
  onboardingId,
  canManage,
}: {
  onboardingId: number;
  canManage: boolean;
}) {
  const [data, setData] = useState<OnboardingData | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getOnboardingData(onboardingId)
      .then((d) => {
        setData(d);
        const flat: Record<string, string> = {};
        for (const [k, v] of Object.entries(d)) {
          if (typeof v === 'string' || v === null) flat[k] = v ?? '';
        }
        setForm(flat);
      })
      .catch((err) => toast.error(err.message))
      .finally(() => setLoading(false));
  }, [onboardingId]);

  if (loading) return <Skeleton className='h-64 w-full' />;
  if (!data) return <p className='text-muted-foreground'>Data belum diisi.</p>;

  const fields = [
    { key: 'full_name', label: 'Nama Lengkap' },
    { key: 'nik', label: 'NIK' },
    { key: 'birth_place', label: 'Tempat Lahir' },
    { key: 'birth_date', label: 'Tanggal Lahir', type: 'date' },
    { key: 'gender', label: 'Jenis Kelamin' },
    { key: 'religion', label: 'Agama' },
    { key: 'address', label: 'Alamat' },
    { key: 'phone', label: 'Telepon' },
    { key: 'emergency_contact_name', label: 'Kontak Darurat - Nama' },
    { key: 'emergency_contact_phone', label: 'Kontak Darurat - Telepon' },
    { key: 'bank_account_number', label: 'No. Rekening' },
    { key: 'bank_account_name', label: 'Nama Rekening' },
    { key: 'npwp', label: 'NPWP' },
    { key: 'bpjs_kesehatan', label: 'BPJS Kesehatan' },
    { key: 'bpjs_ketenagakerjaan', label: 'BPJS Ketenagakerjaan' },
    { key: 'join_date', label: 'Tanggal Bergabung', type: 'date' },
    { key: 'employment_type', label: 'Jenis Pekerjaan' },
  ];

  async function handleSave() {
    setSaving(true);
    try {
      await updateOnboardingData(onboardingId, form);
      toast.success('Data berhasil disimpan.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal menyimpan data.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className='space-y-4'>
      <div className='grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3'>
        {fields.map((f) => (
          <div key={f.key} className='space-y-1.5'>
            <Label htmlFor={f.key}>{f.label}</Label>
            {canManage ? (
              <Input
                id={f.key}
                type={f.type ?? 'text'}
                value={form[f.key] ?? ''}
                onChange={(e) => setForm((p) => ({ ...p, [f.key]: e.target.value }))}
              />
            ) : (
              <p className='text-sm text-muted-foreground'>{form[f.key] || '-'}</p>
            )}
          </div>
        ))}
      </div>
      {canManage && (
        <Button onClick={handleSave} disabled={saving}>
          {saving ? 'Menyimpan...' : 'Simpan Data'}
        </Button>
      )}
    </div>
  );
}

// ── Tab: Checklist ───────────────────────────────────────────────────

function ChecklistTab({
  onboardingId,
  canManage,
}: {
  onboardingId: number;
  canManage: boolean;
}) {
  const [items, setItems] = useState<OnboardingChecklistItem[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setItems(await listChecklist(onboardingId));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal memuat checklist.');
    } finally {
      setLoading(false);
    }
  }, [onboardingId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggleItem(item: OnboardingChecklistItem) {
    try {
      await updateChecklistItem(onboardingId, item.id, {
        completed: !item.completed,
      });
      toast.success(`${item.name} ${item.completed ? 'dibatalkan' : 'selesai'}.`);
      void load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal memperbarui item.');
    }
  }

  if (loading) return <Skeleton className='h-48 w-full' />;

  const categories = [...new Set(items.map((i) => i.category))];

  return (
    <div className='space-y-6'>
      {categories.map((cat) => (
        <div key={cat}>
          <h4 className='mb-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground'>
            {cat}
          </h4>
          <div className='space-y-2'>
            {items
              .filter((i) => i.category === cat)
              .sort((a, b) => a.ordering - b.ordering)
              .map((item) => (
                <div
                  key={item.id}
                  className='flex items-start gap-3 rounded-lg border p-3'
                >
                  <button
                    onClick={() => canManage && toggleItem(item)}
                    disabled={!canManage}
                    className='mt-0.5 shrink-0'
                    aria-label={item.completed ? 'Tandai belum selesai' : 'Tandai selesai'}
                  >
                    {item.completed ? (
                      <Icons.circleCheck className='h-5 w-5 text-emerald-500' />
                    ) : (
                      <Icons.circle className='h-5 w-5 text-muted-foreground' />
                    )}
                  </button>
                  <div className='min-w-0 flex-1'>
                    <p className='text-sm font-medium'>{item.name}</p>
                    {item.notes && (
                      <p className='text-xs text-muted-foreground'>{item.notes}</p>
                    )}
                    {item.completed && item.completed_by_name && (
                      <p className='mt-1 text-xs text-muted-foreground'>
                        Selesai oleh {item.completed_by_name} — {item.completed_at ?? '-'}
                      </p>
                    )}
                  </div>
                  {item.required && (
                    <Badge variant='secondary' className='shrink-0 text-xs'>
                      Wajib
                    </Badge>
                  )}
                </div>
              ))}
          </div>
        </div>
      ))}
      {items.length === 0 && (
        <p className='text-sm text-muted-foreground'>Belum ada item checklist.</p>
      )}
    </div>
  );
}

// ── Tab: Documents ───────────────────────────────────────────────────

function DocumentsTab({
  onboardingId,
  canManage,
}: {
  onboardingId: number;
  canManage: boolean;
}) {
  const [docs, setDocs] = useState<OnboardingDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploadType, setUploadType] = useState('');
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  const load = useCallback(async () => {
    try {
      setDocs(await listDocuments(onboardingId));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal memuat dokumen.');
    } finally {
      setLoading(false);
    }
  }, [onboardingId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleUpload() {
    if (!uploadFile || !uploadType) {
      toast.error('Pilih jenis dokumen dan file.');
      return;
    }
    setUploading(true);
    try {
      await uploadDocument(onboardingId, uploadFile, uploadType);
      toast.success('Dokumen berhasil diunggah.');
      setUploadFile(null);
      setUploadType('');
      void load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal mengunggah.');
    } finally {
      setUploading(false);
    }
  }

  async function handleReview(
    docId: number,
    status: string,
    rejectionReason?: string
  ) {
    try {
      await updateDocument(onboardingId, docId, {
        status,
        rejection_reason: rejectionReason ?? '',
      });
      toast.success(`Dokumen ${status === 'APPROVED' ? 'disetujui' : 'ditolak'}.`);
      void load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal memperbarui dokumen.');
    }
  }

  async function handleDelete(docId: number) {
    try {
      await deleteDocument(onboardingId, docId);
      toast.success('Dokumen dihapus.');
      void load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal menghapus dokumen.');
    }
  }

  async function handleDownload(doc: OnboardingDocument) {
    try {
      const blob = await import('@/lib/onboarding').then((m) =>
        m.downloadDocument(onboardingId, doc.id)
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = doc.original_name;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal mengunduh.');
    }
  }

  if (loading) return <Skeleton className='h-48 w-full' />;

  return (
    <div className='space-y-4'>
      {canManage && (
        <Card>
          <CardHeader>
            <CardTitle className='text-base'>Unggah Dokumen</CardTitle>
          </CardHeader>
          <CardContent className='space-y-3'>
            <div className='grid grid-cols-1 gap-3 sm:grid-cols-3'>
              <div className='space-y-1.5'>
                <Label htmlFor='doc-type'>Jenis Dokumen</Label>
                <select
                  id='doc-type'
                  value={uploadType}
                  onChange={(e) => setUploadType(e.target.value)}
                  className='flex h-10 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50'
                >
                  <option value='' disabled>Pilih jenis</option>
                  {DOC_TYPE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className='space-y-1.5'>
                <Label htmlFor='doc-file'>File</Label>
                <Input
                  id='doc-file'
                  type='file'
                  onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)}
                />
              </div>
              <div className='flex items-end'>
                <Button
                  onClick={handleUpload}
                  disabled={uploading || !uploadFile || !uploadType}
                  className='w-full'
                >
                  {uploading ? 'Mengunggah...' : 'Unggah'}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {docs.length === 0 ? (
        <p className='text-sm text-muted-foreground'>Belum ada dokumen.</p>
      ) : (
        <div className='overflow-x-auto'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Jenis</TableHead>
                <TableHead>Nama File</TableHead>
                <TableHead>Ukuran</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Diunggah</TableHead>
                <TableHead className='text-right'>Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {docs.map((doc) => (
                <TableRow key={doc.id}>
                  <TableCell>
                    <span className='text-xs font-medium'>{doc.document_type_label}</span>
                  </TableCell>
                  <TableCell className='max-w-[200px] truncate'>
                    {doc.original_name}
                  </TableCell>
                  <TableCell>{formatBytes(doc.file_size)}</TableCell>
                  <TableCell>
                    <Badge variant={docStatusVariant(doc.status)}>
                      {doc.status_label}
                    </Badge>
                  </TableCell>
                  <TableCell className='text-xs'>{doc.uploaded_by_name ?? '-'}</TableCell>
                  <TableCell className='text-right'>
                    <div className='flex items-center justify-end gap-1'>
                      <Button
                        size='icon'
                        variant='ghost'
                        onClick={() => handleDownload(doc)}
                        title='Download'
                      >
                        <Icons.download className='h-4 w-4' />
                      </Button>
                      {canManage && doc.status === 'PENDING' && (
                        <>
                          <Button
                            size='icon'
                            variant='ghost'
                            onClick={() => handleReview(doc.id, 'APPROVED')}
                            title='Setujui'
                          >
                            <Icons.circleCheck className='h-4 w-4 text-emerald-500' />
                          </Button>
                          <Button
                            size='icon'
                            variant='ghost'
                            onClick={() => {
                              const reason = window.prompt('Alasan penolakan:');
                              if (reason !== null)
                                handleReview(doc.id, 'REJECTED', reason || undefined);
                            }}
                            title='Tolak'
                          >
                            <Icons.close className='h-4 w-4 text-red-500' />
                          </Button>
                        </>
                      )}
                      {canManage && (
                        <Button
                          size='icon'
                          variant='ghost'
                          onClick={() => handleDelete(doc.id)}
                          title='Hapus'
                        >
                          <Icons.trash className='h-4 w-4' />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

// ── Tab: Summary ─────────────────────────────────────────────────────

function SummaryTab({ onboardingId }: { onboardingId: number }) {
  const [readiness, setReadiness] = useState<OnboardingReadiness | null>(null);
  const [loading, setLoading] = useState(true);
  const [item, setItem] = useState<Onboarding | null>(null);

  useEffect(() => {
    Promise.all([
      getReadiness(onboardingId),
      getOnboarding(onboardingId),
    ])
      .then(([r, o]) => {
        setReadiness(r);
        setItem(o);
      })
      .catch((err) => toast.error(err.message))
      .finally(() => setLoading(false));
  }, [onboardingId]);

  if (loading) return <Skeleton className='h-48 w-full' />;
  if (!readiness) return null;

  return (
    <div className='space-y-4'>
      <Card>
        <CardHeader>
          <CardTitle className='text-base'>Kesiapan Onboarding</CardTitle>
        </CardHeader>
        <CardContent className='space-y-4'>
          <div className='flex items-center gap-3'>
            <span className='text-sm font-medium'>Status:</span>
            <Badge
              variant={
                readiness.ready
                  ? 'secondary'
                  : readiness.status === 'CANCELLED'
                    ? 'outline'
                    : 'default'
              }
            >
              {readiness.ready ? 'Siap' : onboardingStatusLabel(readiness.status)}
            </Badge>
          </div>
          <div className='space-y-1.5'>
            <div className='flex justify-between text-sm'>
              <span className='text-muted-foreground'>Progress Checklist</span>
              <span>{readiness.progress}%</span>
            </div>
            <Progress value={readiness.progress} />
          </div>
          {readiness.errors.length > 0 && (
            <div className='space-y-1'>
              <p className='text-sm font-medium text-red-600'>Kendala:</p>
              <ul className='list-inside list-disc space-y-0.5 text-sm text-red-600'>
                {readiness.errors.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            </div>
          )}
          {readiness.errors.length === 0 && readiness.ready && (
            <p className='text-sm font-medium text-emerald-600'>
              Semua persyaratan terpenuhi. Onboarding siap dikonfirmasi.
            </p>
          )}
        </CardContent>
      </Card>

      {item && item.status_history.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className='text-base'>Riwayat Status</CardTitle>
          </CardHeader>
          <CardContent className='p-0'>
            <div className='overflow-x-auto'>
              <Table>
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
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────────

export function OnboardingDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const [item, setItem] = useState<Onboarding | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('Data');

  const canManage = user?.role ? HR_ROLES.has(user.role) : false;

  const load = useCallback(async () => {
    try {
      setItem(await getOnboarding(Number(id)));
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
      void load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal mengubah status.');
    }
  }

  const [completing, setCompleting] = useState(false);

  async function handleComplete() {
    if (!window.confirm(
      'Konfirmasi Complete Onboarding?\n\n' +
      'Tindakan ini akan:\n' +
      '• Membuat Employee baru\n' +
      '• Membuat Contract\n' +
      '• Membuat User Account\n' +
      '\nLanjutkan?'
    )) return;
    setCompleting(true);
    try {
      await completeOnboarding(Number(id));
      toast.success('Onboarding berhasil dikompletasi! Employee & Account telah dibuat.');
      void load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal mengompletasi onboarding.');
    } finally {
      setCompleting(false);
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
      {/* Header */}
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

      {/* Info Cards */}
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

        {canManage && item.next_statuses.length > 0 && item.status !== 'READY' && (
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

        {canManage && item.status === 'READY' && (
          <Card>
            <CardHeader>
              <CardTitle className='text-base'>Complete Onboarding</CardTitle>
              <CardDescription>
                Konfirmasi untuk membuat Employee, Contract, dan Account
              </CardDescription>
            </CardHeader>
            <CardContent className='flex flex-wrap gap-2'>
              <Button
                size='sm'
                variant='default'
                className='bg-emerald-600 hover:bg-emerald-700'
                onClick={() => handleComplete()}
              >
                <Icons.circleCheck className='mr-1.5 h-4 w-4' />
                Complete Onboarding
              </Button>
            </CardContent>
          </Card>
        )}

        {item.status === 'COMPLETED' && item.employee_id && (
          <Card>
            <CardHeader>
              <CardTitle className='text-base'>Hasil Onboarding</CardTitle>
            </CardHeader>
            <CardContent className='space-y-2 text-sm'>
              <div className='flex justify-between'>
                <span className='text-muted-foreground'>Employee ID</span>
                <span className='font-medium'>{item.employee_id}</span>
              </div>
              <div className='flex justify-between'>
                <span className='text-muted-foreground'>Nama</span>
                <span>{item.employee_name}</span>
              </div>
              <div className='flex justify-between'>
                <span className='text-muted-foreground'>Status</span>
                <Badge variant='secondary'>{item.employee_status}</Badge>
              </div>
              <div className='flex justify-between'>
                <span className='text-muted-foreground'>Account</span>
                <Badge
                  variant={
                    item.account_status === 'ACTIVE'
                      ? 'secondary'
                      : 'outline'
                  }
                >
                  {item.account_status === 'ACTIVE'
                    ? 'Active'
                    : item.account_status === 'INACTIVE'
                      ? 'Inactive'
                      : 'No Account'}
                </Badge>
              </div>
              {item.completed_by_name && (
                <div className='flex justify-between'>
                  <span className='text-muted-foreground'>Dikompletasi oleh</span>
                  <span>{item.completed_by_name}</span>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      {/* Tabs */}
      <div className='flex gap-1 border-b'>
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              tab === t
                ? 'border-b-2 border-primary text-primary'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {t === 'Data' && <Icons.forms className='mr-1.5 inline h-4 w-4' />}
            {t === 'Checklist' && <Icons.task className='mr-1.5 inline h-4 w-4' />}
            {t === 'Documents' && <Icons.page className='mr-1.5 inline h-4 w-4' />}
            {t === 'Summary' && <Icons.report className='mr-1.5 inline h-4 w-4' />}
            {t}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className='min-h-[200px]'>
        {tab === 'Data' && <DataTab onboardingId={Number(id)} canManage={canManage} />}
        {tab === 'Checklist' && (
          <ChecklistTab onboardingId={Number(id)} canManage={canManage} />
        )}
        {tab === 'Documents' && (
          <DocumentsTab onboardingId={Number(id)} canManage={canManage} />
        )}
        {tab === 'Summary' && <SummaryTab onboardingId={Number(id)} />}
      </div>
    </div>
  );
}
