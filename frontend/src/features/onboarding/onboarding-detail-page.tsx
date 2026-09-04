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
  listDocuments,
  uploadDocument,
  updateDocument,
  deleteDocument,
  getReadiness,
  hardDeleteOnboarding,
  type Onboarding,
  type OnboardingData,
  type OnboardingChecklistItem,
  type OnboardingDocument,
  type OnboardingReadiness,
} from '@/lib/onboarding';
import { listDepartments, listPositions, listPersonnel } from '@/lib/employees';
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
import { Fragment, createContext, useCallback, useContext, useEffect, useState } from 'react';
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

// Lightweight tab-switch context so child tabs can jump to another tab.
const TabSwitchContext = createContext<(t: Tab) => void>(() => {});
function useTabSwitch() {
  return useContext(TabSwitchContext);
}

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

type FieldDef =
  | { key: string; label: string; type?: 'text' | 'date' | 'email'; sensitive?: boolean }
  | { key: string; label: string; type: 'select'; options: { value: string; label: string }[] }
  | { key: string; label: string; type: 'checkbox' };

const MANDATORY_DATA_KEYS = new Set([
  'full_name', 'nik', 'birth_place', 'birth_date', 'address', 'phone',
  'emergency_contact_name', 'emergency_contact_phone',
  'bank_account_number', 'bank_account_name', 'npwp',
  'bpjs_kesehatan', 'bpjs_ketenagakerjaan',
  'department', 'position', 'join_date', 'employment_type',
]);

const EMPLOYMENT_TYPES = [
  { value: 'PKWTT', label: 'PKWTT (Tetap)' },
  { value: 'PKWT', label: 'PKWT (Kontrak)' },
];

const DATA_SECTIONS: { title: string; fields: FieldDef[] }[] = [
  {
    title: 'Biodata',
    fields: [
      { key: 'full_name', label: 'Nama Lengkap' },
      { key: 'nik', label: 'NIK', sensitive: true },
      { key: 'birth_place', label: 'Tempat Lahir' },
      { key: 'birth_date', label: 'Tanggal Lahir', type: 'date' },
      { key: 'address', label: 'Alamat' },
      { key: 'phone', label: 'No HP' },
      { key: 'personal_email', label: 'Email Pribadi', type: 'email' },
    ],
  },
  {
    title: 'Kontak Darurat',
    fields: [
      { key: 'emergency_contact_name', label: 'Nama' },
      { key: 'emergency_contact_phone', label: 'No HP' },
    ],
  },
  {
    title: 'Data Legal & Finansial',
    fields: [
      { key: 'npwp', label: 'NPWP', sensitive: true },
      { key: 'bpjs_kesehatan', label: 'BPJS Kesehatan' },
      { key: 'bpjs_ketenagakerjaan', label: 'BPJS Ketenagakerjaan' },
      { key: 'bank_account_number', label: 'No. Rekening', sensitive: true },
      { key: 'bank_account_name', label: 'Nama Pemilik Rekening' },
    ],
  },
  {
    title: 'Data Kepegawaian',
    fields: [
      { key: 'department', label: 'Department', type: 'select', options: [] },
      { key: 'position', label: 'Position', type: 'select', options: [] },
      { key: 'reporting_to', label: 'Reporting To', type: 'select', options: [] },
      { key: 'join_date', label: 'Tanggal Bergabung', type: 'date' },
      { key: 'employment_type', label: 'Jenis Pekerjaan', type: 'select', options: EMPLOYMENT_TYPES },
      { key: 'probation_enabled', label: 'Aktifkan Probation (PKWTT)', type: 'checkbox' },
      { key: 'probation_start_date', label: 'Probation Mulai', type: 'date' },
      { key: 'probation_end_date', label: 'Probation Selesai', type: 'date' },
    ],
  },
];

function DataTab({
  onboardingId,
  canManage,
}: {
  onboardingId: number;
  canManage: boolean;
}) {
  const [data, setData] = useState<OnboardingData | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [departments, setDepartments] = useState<{ id: number; name: string }[]>([]);
  const [positions, setPositions] = useState<{ id: number; name: string }[]>([]);
  const [personnel, setPersonnel] = useState<{ id: number; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await getOnboardingData(onboardingId);
      setData(d);
      const flat: Record<string, string> = {};
      for (const [k, v] of Object.entries(d)) {
        if (typeof v === 'string' || typeof v === 'boolean' || v === null) {
          flat[k] = v === null ? '' : String(v);
        }
      }
      setForm(flat);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal memuat data.');
    } finally {
      setLoading(false);
    }
  }, [onboardingId]);

  useEffect(() => {
    void load();
    if (canManage) {
      Promise.all([
        listDepartments(),
        listPersonnel(),
      ])
        .then(([deps, people]) => {
          setDepartments(deps);
          setPersonnel(people.map((p) => ({ id: p.id, name: p.full_name })));
        })
        .catch(() => {});
    }
  }, [load, canManage, onboardingId]);

  useEffect(() => {
    if (!form.department) {
      setPositions([]);
      return;
    }
    listPositions(Number(form.department))
      .then(setPositions)
      .catch(() => setPositions([]));
  }, [form.department]);

  if (loading) return <Skeleton className='h-64 w-full' />;
  if (!data) return <p className='text-muted-foreground'>Data belum diisi.</p>;

  async function handleSave() {
    setSaving(true);
    try {
      const payload: Record<string, string | number | boolean | null> = {};
      const isPkwtt = form.employment_type === 'PKWTT';
      const probationOn = isPkwtt && form.probation_enabled === 'true';
      for (const [k, v] of Object.entries(form)) {
        if (k === 'probation_enabled') payload[k] = probationOn;
        else if (k === 'probation_start_date' || k === 'probation_end_date') {
          payload[k] = probationOn ? (v || null) : null;
        } else if (['department', 'position', 'reporting_to'].includes(k)) {
          payload[k] = v ? Number(v) : null;
        } else payload[k] = v || null;
      }
      await updateOnboardingData(onboardingId, payload);
      toast.success('Data berhasil disimpan.');
      setEditing(false);
      void load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal menyimpan data.');
    } finally {
      setSaving(false);
    }
  }

  const selectOptions: Record<string, { value: string; label: string }[]> = {
    department: departments.map((d) => ({ value: String(d.id), label: d.name })),
    position: positions.map((p) => ({ value: String(p.id), label: p.name })),
    reporting_to: personnel.map((p) => ({ value: String(p.id), label: p.name })),
  };

  return (
    <div className='space-y-4'>
      <div className='flex items-center justify-between'>
        <h3 className='text-sm font-semibold text-muted-foreground'>Data Onboarding</h3>
        {canManage &&
          (editing ? (
            <div className='flex gap-2'>
              <Button variant='ghost' size='sm' onClick={() => { setEditing(false); void load(); }} disabled={saving}>
                Batal
              </Button>
              <Button size='sm' onClick={handleSave} disabled={saving}>
                {saving ? 'Menyimpan...' : 'Simpan Data'}
              </Button>
            </div>
          ) : (
            <Button variant='outline' size='sm' onClick={() => setEditing(true)}>
              <Icons.forms className='mr-1.5 h-4 w-4' />
              Edit Data
            </Button>
          ))}
      </div>

      <div className='grid grid-cols-1 gap-4 lg:grid-cols-2'>
        {DATA_SECTIONS.map((section) => (
          <Card key={section.title}>
            <CardHeader className='pb-3'>
              <CardTitle className='text-sm'>{section.title}</CardTitle>
            </CardHeader>
            <CardContent className='space-y-3'>
              {section.fields.map((f) => {
                // Conditional visibility per spec
                if (f.key === 'probation_enabled' && form.employment_type !== 'PKWTT') return null;
                if (
                  (f.key === 'probation_start_date' || f.key === 'probation_end_date') &&
                  form.probation_enabled !== 'true'
                )
                  return null;
                const editable = editing && canManage;
                const mandatory = MANDATORY_DATA_KEYS.has(f.key);
                const empty = !form[f.key];
                if (f.type === 'checkbox') {
                  return (
                    <label key={f.key} className='flex items-center gap-2 text-sm'>
                      <input
                        type='checkbox'
                        checked={form[f.key] === 'true'}
                        disabled={!editable}
                        onChange={(e) => setForm((p) => ({ ...p, [f.key]: String(e.target.checked) }))}
                      />
                      {f.label}
                    </label>
                  );
                }
                if (f.type === 'select') {
                  const opts = selectOptions[f.key] ?? f.options ?? [];
                  return (
                    <div key={f.key} className='space-y-1.5'>
                      <Label htmlFor={f.key}>
                        {f.label}
                        {mandatory && <span className='text-destructive'> *</span>}
                      </Label>
                      <select
                        id={f.key}
                        disabled={!editable}
                        className='border-input h-9 w-full rounded-lg border bg-transparent px-2.5 text-sm disabled:opacity-60'
                        value={form[f.key] ?? ''}
                        onChange={(e) => setForm((p) => ({ ...p, [f.key]: e.target.value }))}
                      >
                        <option value=''>—</option>
                        {opts.map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                      {mandatory && empty && !editing && (
                        <p className='text-xs text-amber-600'>Wajib diisi untuk readiness.</p>
                      )}
                    </div>
                  );
                }
                return (
                  <div key={f.key} className='space-y-1.5'>
                    <Label htmlFor={f.key}>
                      {f.label}
                      {mandatory && <span className='text-destructive'> *</span>}
                    </Label>
                    {editable ? (
                      <Input
                        id={f.key}
                        type={f.type ?? 'text'}
                        value={form[f.key] ?? ''}
                        onChange={(e) => setForm((p) => ({ ...p, [f.key]: e.target.value }))}
                      />
                    ) : (
                      <p className='text-sm'>
                        {form[f.key] || <span className={mandatory ? 'text-amber-600' : 'text-muted-foreground'}>{form[f.key] ? '' : '-'}</span>}
                      </p>
                    )}
                    {mandatory && empty && !editing && (
                      <p className='text-xs text-amber-600'>Wajib diisi untuk readiness.</p>
                    )}
                  </div>
                );
              })}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ── Tab: Checklist ───────────────────────────────────────────────────

const CHECKLIST_HINTS: Record<string, string> = {
  DATA_BIODATA: 'Lengkapi section Biodata pada tab Data.',
  DATA_KONTAK: 'Lengkapi section Kontak Darurat pada tab Data.',
  DATA_FINANSIAL: 'Lengkapi section Data Legal & Finansial pada tab Data.',
  DATA_PEKERJAAN: 'Lengkapi section Data Kepegawaian pada tab Data.',
  KTP: 'Unggah dokumen KTP lalu setujui di tab Documents.',
  KK: 'Unggah dokumen KK lalu setujui di tab Documents.',
  NPWP: 'Unggah dokumen NPWP lalu setujui di tab Documents.',
  BUKU_REKENING: 'Unggah Buku Rekening lalu setujui di tab Documents.',
  KONTRAK_KERJA: 'Unggah Kontrak Kerja yang sudah ditandatangani lalu setujui di tab Documents.',
};

// Checklist completion dikelola backend (sync_checklist): DATA_* dari kelengkapan
// data onboarding, dokumen dari status APPROVED. Tab ini read-only.
function ChecklistTab({
  onboardingId,
  onboardingStatus,
}: {
  onboardingId: number;
  onboardingStatus: string;
}) {
  const [items, setItems] = useState<OnboardingChecklistItem[]>([]);
  const [loading, setLoading] = useState(true);
  const setTab = useTabSwitch();

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

  if (loading) return <Skeleton className='h-48 w-full' />;

  const requiredItems = items.filter((i) => i.required);
  const requiredDone = requiredItems.filter((i) => i.completed).length;
  const requiredPct = requiredItems.length
    ? Math.round((requiredDone / requiredItems.length) * 100)
    : 100;
  const categories = [...new Set(items.map((i) => i.category))];
  const editable = onboardingStatus !== 'COMPLETED' && onboardingStatus !== 'CANCELLED';

  return (
    <div className='space-y-4'>
      <Card>
        <CardContent className='space-y-2 pt-6'>
          <div className='flex items-center justify-between text-sm'>
            <span className='font-medium'>Checklist Wajib</span>
            <span className='text-muted-foreground'>
              {requiredDone} / {requiredItems.length} selesai
            </span>
          </div>
          <Progress value={requiredPct} />
          <p className='text-xs text-muted-foreground'>
            Status checklist dihitung otomatis dari data onboarding dan dokumen yang disetujui.
          </p>
        </CardContent>
      </Card>

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
                  {item.completed ? (
                    <Icons.circleCheck className='mt-0.5 h-5 w-5 shrink-0 text-emerald-500' />
                  ) : (
                    <Icons.circle className='mt-0.5 h-5 w-5 shrink-0 text-muted-foreground' />
                  )}
                  <div className='min-w-0 flex-1'>
                    <p className='text-sm font-medium'>{item.name}</p>
                    {!item.completed && editable && CHECKLIST_HINTS[item.code] && (
                      <button
                        type='button'
                        onClick={() => setTab(CHECKLIST_HINTS[item.code].includes('Data.') ? 'Data' : 'Documents')}
                        className='mt-0.5 text-left text-xs text-primary underline-offset-2 hover:underline'
                      >
                        {CHECKLIST_HINTS[item.code]}
                      </button>
                    )}
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
  const [uploadNotes, setUploadNotes] = useState('');
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
      await uploadDocument(onboardingId, uploadFile, uploadType, uploadNotes);
      toast.success('Dokumen berhasil diunggah. Menunggu persetujuan.');
      setUploadFile(null);
      setUploadType('');
      setUploadNotes('');
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
      a.download = doc.original_filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal mengunduh.');
    }
  }

  if (loading) return <Skeleton className='h-48 w-full' />;

  const REQUIRED_DOC_TYPES = ['KTP', 'KK', 'NPWP', 'BUKU_REKENING', 'KONTRAK_KERJA'];
  const latestByType = new Map<string, OnboardingDocument>();
  for (const d of docs) {
    const cur = latestByType.get(d.document_type);
    if (!cur || new Date(d.created_at) > new Date(cur.created_at)) latestByType.set(d.document_type, d);
  }
  const approvedTypes = new Set(
    [...latestByType.values()].filter((d) => d.status === 'APPROVED').map((d) => d.document_type)
  );
  const approvedCount = REQUIRED_DOC_TYPES.filter((t) => approvedTypes.has(t)).length;

  // Upload form pre-selects the required type when opened from checklist jump.
  function docStatus(type: string) {
    const d = latestByType.get(type);
    return d ? d.status : null;
  }

  return (
    <div className='space-y-4'>
      <Card>
        <CardContent className='space-y-3 pt-6'>
          <div className='flex items-center justify-between text-sm'>
            <span className='font-medium'>Dokumen Wajib Disetujui</span>
            <span className='text-muted-foreground'>{approvedCount} / 5 approved</span>
          </div>
          <Progress value={Math.round((approvedCount / 5) * 100)} />
          <div className='grid grid-cols-1 gap-2 pt-1 sm:grid-cols-2 lg:grid-cols-5'>
            {REQUIRED_DOC_TYPES.map((type) => {
              const st = docStatus(type);
              return (
                <div key={type} className='flex items-center justify-between gap-2 rounded-lg border p-2.5'>
                  <span className='text-xs font-medium'>{DOC_TYPE_OPTIONS.find((o) => o.value === type)?.label ?? type}</span>
                  {st === 'APPROVED' ? (
                    <Icons.circleCheck className='h-4 w-4 shrink-0 text-emerald-500' />
                  ) : st === 'REJECTED' ? (
                    <Icons.close className='h-4 w-4 shrink-0 text-red-500' />
                  ) : st === 'PENDING' ? (
                    <span className='shrink-0 text-[10px] font-medium uppercase text-amber-600'>Pending</span>
                  ) : (
                    <span className='shrink-0 text-[10px] uppercase text-muted-foreground'>Kosong</span>
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

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
                <Label htmlFor='doc-file'>File (PDF/JPG/PNG/DOC, maks 10MB)</Label>
                <Input
                  id='doc-file'
                  type='file'
                  accept='.pdf,.jpg,.jpeg,.png,.doc,.docx'
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
            <div className='space-y-1.5'>
              <Label htmlFor='doc-notes'>Catatan (opsional)</Label>
              <Input
                id='doc-notes'
                value={uploadNotes}
                onChange={(e) => setUploadNotes(e.target.value)}
                placeholder='Catatan tambahan untuk dokumen ini'
              />
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
                <TableHead>Reviewer</TableHead>
                <TableHead className='text-right'>Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {docs.map((doc) => (
                <Fragment key={doc.id}>
                <TableRow>
                  <TableCell>
                    <span className='text-xs font-medium'>{doc.document_type_label}</span>
                  </TableCell>
                  <TableCell className='max-w-[200px] truncate'>
                    {doc.original_filename}
                  </TableCell>
                  <TableCell>{formatBytes(doc.file_size)}</TableCell>
                  <TableCell>
                    <Badge variant={docStatusVariant(doc.status)}>
                      {doc.status_label}
                    </Badge>
                  </TableCell>
                  <TableCell className='text-xs'>{doc.uploaded_by_name ?? '-'}</TableCell>
                  <TableCell className='text-xs'>{doc.reviewed_by_name ?? '-'}</TableCell>
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
                {doc.status === 'REJECTED' && doc.rejection_reason && (
                  <TableRow>
                    <TableCell colSpan={7} className='bg-destructive/5 text-xs text-destructive'>
                      Ditolak: {doc.rejection_reason}
                    </TableCell>
                  </TableRow>
                )}
                </Fragment>
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
  const [checklist, setChecklist] = useState<OnboardingChecklistItem[]>([]);
  const [docs, setDocs] = useState<OnboardingDocument[]>([]);

  useEffect(() => {
    Promise.all([
      getReadiness(onboardingId),
      getOnboarding(onboardingId),
      listChecklist(onboardingId),
      listDocuments(onboardingId),
    ])
      .then(([r, o, c, d]) => {
        setReadiness(r);
        setItem(o);
        setChecklist(c);
        setDocs(d);
      })
      .catch((err) => toast.error(err instanceof Error ? err.message : 'Gagal memuat ringkasan.'))
      .finally(() => setLoading(false));
  }, [onboardingId]);

  if (loading) return <Skeleton className='h-48 w-full' />;
  if (!readiness) return null;

  const reqItems = checklist.filter((i) => i.required);
  const reqDone = reqItems.filter((i) => i.completed).length;
  const REQUIRED_DOC_TYPES = ['KTP', 'KK', 'NPWP', 'BUKU_REKENING', 'KONTRAK_KERJA'];
  const approvedTypes = new Set(
    docs.filter((d) => d.status === 'APPROVED').map((d) => d.document_type)
  );
  const approvedDocs = REQUIRED_DOC_TYPES.filter((t) => approvedTypes.has(t)).length;
  const dataComplete = !readiness.errors.some((e) => e.startsWith('Data employment'));
  const employmentDataOk = !readiness.errors.some((e) => e.includes('employment'));

  const rows = [
    { label: 'Data', ok: dataComplete, detail: dataComplete ? 'Lengkap' : 'Belum lengkap' },
    {
      label: 'Checklist',
      ok: reqItems.length > 0 && reqDone === reqItems.length,
      detail: `${reqDone} / ${reqItems.length} wajib`,
    },
    {
      label: 'Dokumen',
      ok: approvedDocs === 5,
      detail: `${approvedDocs} / 5 approved`,
    },
    {
      label: 'Employment Data',
      ok: employmentDataOk,
      detail: employmentDataOk ? 'Lengkap' : 'Belum lengkap',
    },
  ];

  return (
    <div className='space-y-4'>
      <Card>
        <CardHeader>
          <CardTitle className='text-base'>ONBOARDING PROGRESS</CardTitle>
        </CardHeader>
        <CardContent className='space-y-3'>
          {rows.map((r) => (
            <div key={r.label} className='flex items-center justify-between text-sm'>
              <span className='flex items-center gap-2'>
                {r.ok ? (
                  <Icons.circleCheck className='h-4 w-4 text-emerald-500' />
                ) : (
                  <Icons.circle className='h-4 w-4 text-muted-foreground' />
                )}
                {r.label}
              </span>
              <span className='text-muted-foreground'>{r.detail}</span>
            </div>
          ))}
          <div className='flex items-center justify-between border-t pt-3 text-sm font-medium'>
            <span>Overall</span>
            <span className='flex items-center gap-2'>
              <Badge variant={readiness.ready ? 'secondary' : 'default'}>
                {readiness.ready ? 'READY' : 'BELUM READY'}
              </Badge>
            </span>
          </div>
          {!readiness.ready && readiness.errors.length > 0 && (
            <div className='space-y-1'>
              <p className='text-xs font-medium text-red-600'>Masih kurang:</p>
              <ul className='list-inside list-disc space-y-0.5 text-xs text-red-600'>
                {readiness.errors.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      {readiness.errors.length > 0 && (
        <Card>
          <CardContent className='space-y-1 pt-6'>
            <p className='text-sm font-medium text-red-600'>Kendala:</p>
            <ul className='list-inside list-disc space-y-0.5 text-sm text-red-600'>
              {readiness.errors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

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
  const [confirmComplete, setConfirmComplete] = useState(false);

  async function handleComplete() {
    setConfirmComplete(false);
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

  async function handleDelete() {
    if (!item) return;
    if (!window.confirm(`Hapus permanen onboarding "${item.candidate_name}"? Tidak dapat dibatalkan.`)) return;
    try {
      await hardDeleteOnboarding(item.id);
      toast.success('Onboarding dihapus permanen.');
      router.push('/dashboard/onboarding');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal menghapus onboarding.');
    }
  }

  function primaryAction() {
    if (!canManage || item!.status === 'CANCELLED' || item!.status === 'COMPLETED') return null;
    if (item!.status === 'READY') {
      return (
        <Button onClick={() => setConfirmComplete(true)} disabled={completing}>
          <Icons.circleCheck className='mr-1.5 h-4 w-4' />
          {completing ? 'Memproses...' : 'Complete Onboarding'}
        </Button>
      );
    }
    // Contextual CTA: guide HR to the tab where work is needed.
    // Use explicit target status — never next_statuses[index] (backend returns sorted, so [0] can be CANCELLED).
    const cta: Record<string, { label: string; next: string; tab?: Tab }> = {
      PENDING: { label: 'Mulai Onboarding', next: 'IN_PROGRESS' },
      IN_PROGRESS: { label: 'Lengkapi Data', next: 'DOCUMENT_REVIEW', tab: 'Data' },
      DOCUMENT_REVIEW: { label: 'Review Dokumen', next: 'READY', tab: 'Documents' },
    };
    const action = cta[item!.status];
    if (!action) return null;
    return (
      <Button
        onClick={() => {
          if (action.tab) setTab(action.tab);
          void handleTransition(action.next);
        }}
      >
        {item!.status === 'PENDING' && <Icons.arrowRight className='mr-1.5 h-4 w-4' />}
        {action.label}
      </Button>
    );
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
      <div className='flex flex-wrap items-start justify-between gap-3'>
        <div>
          <div className='flex items-center gap-2'>
            <h2 className='text-2xl font-bold tracking-tight'>{item.candidate_name}</h2>
            <Badge variant={onboardingStatusVariant(item.status)} className='text-sm'>
              {onboardingStatusLabel(item.status)}
            </Badge>
          </div>
          <p className='text-muted-foreground text-sm'>
            {item.job_title}
            {item.department_name ? ` · ${item.department_name}` : ''}
            {item.position_name ? ` · ${item.position_name}` : ''}
          </p>
          {item.target_join_date && (
            <p className='text-muted-foreground mt-0.5 text-xs'>
              Target Join: {item.target_join_date}
            </p>
          )}
        </div>
        <div className='flex items-center gap-2'>
          {primaryAction()}
          {canManage && user?.role === 'admin' && (
            <Button variant='destructive' size='sm' onClick={() => handleDelete()}>
              Hapus Permanen
            </Button>
          )}
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
              <Button
                variant='outline'
                size='sm'
                className='mt-2 w-full'
                onClick={() => router.push(`/dashboard/karyawan/${item.employee}`)}
              >
                <Icons.arrowRight className='mr-1.5 h-4 w-4' />
                Lihat Employee
              </Button>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Complete confirmation modal */}
      {confirmComplete && (
        <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4'>
          <div className='w-full max-w-md rounded-xl border bg-popover p-6 text-popover-foreground shadow-lg'>
            <h3 className='text-base font-semibold'>Finalisasi onboarding?</h3>
            <p className='text-muted-foreground mt-2 text-sm'>
              Data onboarding akan digunakan untuk membuat data karyawan dan akun employee.
              Pastikan seluruh data sudah benar.
            </p>
            <div className='mt-4 flex justify-end gap-2'>
              <Button variant='ghost' onClick={() => setConfirmComplete(false)} disabled={completing}>
                Batal
              </Button>
              <Button onClick={handleComplete} disabled={completing}>
                {completing ? 'Memproses...' : 'Complete Onboarding'}
              </Button>
            </div>
          </div>
        </div>
      )}

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
        <TabSwitchContext.Provider value={setTab}>
          {tab === 'Data' && <DataTab onboardingId={Number(id)} canManage={canManage} />}
          {tab === 'Checklist' && (
            <ChecklistTab onboardingId={Number(id)} onboardingStatus={item.status} />
          )}
          {tab === 'Documents' && (
            <DocumentsTab onboardingId={Number(id)} canManage={canManage} />
          )}
          {tab === 'Summary' && <SummaryTab onboardingId={Number(id)} />}
        </TabSwitchContext.Provider>
      </div>
    </div>
  );
}
