'use client';

import { Fragment, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Icons } from '@/components/icons';
import {
  type PayrollComponent,
  type SalaryStructure,
  type PayrollPeriod,
  type Payroll,
  type TaxConfig,
  type EmployeeTaxProfile,
  listComponents,
  createComponent,
  updateComponent,
  deleteComponent,
  listStructures,
  createStructure,
  historyStructures,
  deactivateStructure,
  deleteStructure,
  listPeriods,
  createPeriod,
  deletePeriod,
  transitionPeriod,
  recalculatePeriod,
  getPeriodReview,
  getPeriodEligibility,
  type ReviewData,
  type EligibilityData,
  addManualItem,
  removeManualItem,
  downloadPayslip,
  downloadRecap,
  listTaxConfigs,
  updateTaxConfig,
  replaceTaxBrackets,
  replaceAnnualBrackets,
  listTaxProfiles,
  upsertTaxProfile,
  resetTaxProfile,
} from '@/lib/payroll';
import { listEmployees, type Employee } from '@/lib/employees';
import { useAuth } from '@/lib/auth/auth-provider';
import { toast } from 'react-toastify';

const CATEGORY = [
  { value: 'EARNING_FIXED', label: 'Gaji Pokok & Tunjangan Tetap' },
  { value: 'EARNING_VARIABLE', label: 'Tunjangan Tidak Tetap' },
  { value: 'DEDUCTION', label: 'Potongan' },
];

const CALC = [
  { value: 'FIXED_AMOUNT', label: 'Jumlah Tetap' },
  { value: 'VARIABLE', label: 'Variabel' },
  { value: 'PERCENTAGE', label: 'Persentase' },
];

const PTKP_OPTIONS = ['TK/0', 'TK/1', 'TK/2', 'TK/3', 'K/0', 'K/1', 'K/2', 'K/3'];

function apiError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return 'Terjadi kesalahan.';
}

// ---------- (1) Komponen gaji ----------

const COMPONENT_GROUPS: {
  value: PayrollComponent['category'];
  label: string;
  hint: string;
  sign: '+' | '−';
  tone: string;
}[] = [
  { value: 'EARNING_FIXED', label: 'Pendapatan tetap', hint: 'dibayar tiap bulan dari struktur gaji', sign: '+', tone: 'text-primary bg-primary/10' },
  { value: 'EARNING_VARIABLE', label: 'Pendapatan tidak tetap', hint: 'diisi per periode', sign: '+', tone: 'text-blue-700 bg-blue-500/10 dark:text-blue-300' },
  { value: 'DEDUCTION', label: 'Potongan', hint: 'mengurangi THP', sign: '−', tone: 'text-red-700 bg-red-500/10 dark:text-red-300' },
];

function ComponentForm({
  editing,
  onClose,
  onSaved,
}: {
  editing: PayrollComponent | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    name: editing?.name ?? '',
    code: editing?.code ?? '',
    category: editing?.category ?? 'EARNING_FIXED',
    calculation_type: editing?.calculation_type ?? 'FIXED_AMOUNT',
    default_amount: editing?.default_amount ?? '',
    description: editing?.description ?? '',
    sort_order: editing?.sort_order ?? 0,
    is_reimbursement: editing?.is_reimbursement ?? false,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!form.name.trim() || !form.code.trim()) {
      setError('Nama dan Kode wajib diisi.');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        ...form,
        code: form.code.trim().toUpperCase(),
        default_amount: form.default_amount || null,
        sort_order: Number(form.sort_order),
      };
      if (editing) await updateComponent(editing.id, payload);
      else await createComponent(payload);
      onSaved();
    } catch (err) {
      setError(apiError(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{editing ? `Edit komponen · ${editing.name}` : 'Komponen baru'}</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className='space-y-4'>
          {error && <p className='text-destructive text-sm'>{error}</p>}
          <div className='grid grid-cols-1 gap-4 md:grid-cols-2'>
            <div className='space-y-1.5'>
              <Label>Nama</Label>
              <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            </div>
            <div className='space-y-1.5'>
              <Label>Kode</Label>
              <Input
                value={form.code}
                onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
                placeholder='CONTOH'
                className='font-mono'
              />
            </div>
            <div className='space-y-1.5'>
              <Label>Kategori</Label>
              <select
                value={form.category}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    category: e.target.value as 'EARNING_FIXED' | 'EARNING_VARIABLE' | 'DEDUCTION',
                  }))
                }
                className='border-input h-8 w-full rounded-lg border bg-transparent px-2.5 text-sm'
              >
                {CATEGORY.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
            <div className='space-y-1.5'>
              <Label>Tipe Perhitungan</Label>
              <select
                value={form.calculation_type}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    calculation_type: e.target.value as 'FIXED_AMOUNT' | 'VARIABLE' | 'PERCENTAGE',
                  }))
                }
                className='border-input h-8 w-full rounded-lg border bg-transparent px-2.5 text-sm'
              >
                {CALC.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
            <div className='space-y-1.5'>
              <Label>Nilai Default (kosongkan jika variabel/persen)</Label>
              <Input
                type='number'
                step='0.01'
                value={form.default_amount}
                onChange={(e) => setForm((f) => ({ ...f, default_amount: e.target.value }))}
              />
            </div>
            <div className='space-y-1.5'>
              <Label>Deskripsi</Label>
              <Input
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              />
            </div>
            <div className='flex items-center gap-2 pt-1'>
              <Switch
                checked={form.is_reimbursement}
                onCheckedChange={(v) => setForm((f) => ({ ...f, is_reimbursement: v }))}
              />
              <Label>Reimbursement</Label>
            </div>
          </div>
          <div className='flex justify-end gap-2'>
            <Button type='button' variant='outline' onClick={onClose}>
              Batal
            </Button>
            <Button type='submit' disabled={saving}>
              {saving ? 'Menyimpan...' : 'Simpan'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function ComponentsTable({ readOnly = false }: { readOnly?: boolean }) {
  const [components, setComponents] = useState<PayrollComponent[]>([]);
  const [structures, setStructures] = useState<SalaryStructure[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState<'' | PayrollComponent['category']>('');
  const [editing, setEditing] = useState<PayrollComponent | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const [c, s] = await Promise.all([listComponents(), listStructures().catch(() => [] as SalaryStructure[])]);
      setComponents(c);
      setStructures(s);
    } catch (err) {
      setError(apiError(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  // Display order inside each category (sort_order, then name).
  const ordered = (cat: PayrollComponent['category']) =>
    components
      .filter((c) => c.category === cat)
      .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
  const matches = (c: PayrollComponent) =>
    !search || `${c.name} ${c.code}`.toLowerCase().includes(search.toLowerCase());
  const usage = (code: string) => structures.filter((s) => s.components.some((x) => x.code === code)).length;

  function openAdd() { setEditing(null); setShowForm(true); }
  function openEdit(c: PayrollComponent) { setEditing(c); setShowForm(true); }
  function closeForm() { setEditing(null); setShowForm(false); }

  async function handleDelete(c: PayrollComponent) {
    if (!window.confirm(`Hapus ${c.name} (${c.code})?`)) return;
    try {
      await deleteComponent(c.id);
      load();
    } catch (err) {
      setError(apiError(err));
    }
  }

  async function toggleActive(c: PayrollComponent) {
    setBusy(true);
    try {
      const updated = await updateComponent(c.id, { is_active: !c.is_active });
      setComponents((prev) => prev.map((x) => (x.id === c.id ? updated : x)));
    } catch (err) { setError(apiError(err)); }
    finally { setBusy(false); }
  }

  /** Move one step up/down inside its category; renumbers sort_order 10, 20, ... */
  async function move(c: PayrollComponent, dir: -1 | 1) {
    const list = ordered(c.category);
    const i = list.findIndex((x) => x.id === c.id);
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    setBusy(true);
    try {
      const changed = list.map((x, k) => ({ x, order: (k + 1) * 10 })).filter(({ x, order }) => x.sort_order !== order);
      const updated = await Promise.all(changed.map(({ x, order }) => updateComponent(x.id, { sort_order: order })));
      setComponents((prev) => prev.map((x) => updated.find((u) => u.id === x.id) ?? x));
    } catch (err) { setError(apiError(err)); }
    finally { setBusy(false); }
  }

  const count = (cat: PayrollComponent['category']) => components.filter((c) => c.category === cat).length;
  const chips: { value: '' | PayrollComponent['category']; label: string }[] = [
    { value: '', label: `Semua · ${components.length}` },
    ...COMPONENT_GROUPS.map((g) => ({ value: g.value, label: `${g.label} · ${count(g.value)}` })),
  ];
  const activeEarnings = [...ordered('EARNING_FIXED'), ...ordered('EARNING_VARIABLE')].filter((c) => c.is_active);
  const activeDeductions = ordered('DEDUCTION').filter((c) => c.is_active);

  return (
    <div className='grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_360px]'>
      <div className='flex min-w-0 flex-col gap-4'>
        {showForm && (
          <ComponentForm editing={editing} onClose={closeForm} onSaved={() => { closeForm(); load(); }} />
        )}
        <Card className='gap-0 overflow-hidden py-0'>
          <div className='flex flex-wrap items-start justify-between gap-3 px-6 pt-5 pb-4'>
            <div>
              <h3 className='text-lg font-semibold'>Komponen gaji</h3>
              <p className='text-muted-foreground mt-0.5 text-sm'>
                Pendapatan dan potongan yang bisa dipakai di struktur gaji &amp; proses payroll.
              </p>
            </div>
            <div className='flex flex-wrap items-center gap-2'>
              <div className='relative'>
                <Icons.search className='text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2' />
                <Input
                  placeholder='Cari nama / kode'
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className='h-10 w-60 pl-9'
                />
              </div>
              {!readOnly && (
                <Button className='h-10' onClick={openAdd}><Icons.add />Komponen baru</Button>
              )}
            </div>
          </div>
          <div className='flex flex-wrap gap-2 px-6 pb-4'>
            {chips.map((c) => (
              <button
                key={c.label}
                type='button'
                onClick={() => setCatFilter(c.value)}
                className={`rounded-full border px-3.5 py-1.5 text-sm transition-colors ${
                  catFilter === c.value ? 'bg-foreground text-background border-foreground font-medium' : 'hover:bg-muted'
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>

          {error && <p className='text-destructive border-t px-6 py-3 text-sm'>{error}</p>}

          {loading ? (
            <div className='space-y-2 border-t p-6'>
              {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className='h-14 w-full' />)}
            </div>
          ) : (
            COMPONENT_GROUPS.filter((g) => !catFilter || catFilter === g.value).map((g) => {
              const list = ordered(g.value);
              const visible = list.filter(matches);
              if (search && visible.length === 0) return null;
              return (
                <section key={g.value} className='border-t'>
                  <p className='bg-muted/30 flex items-center gap-2 px-6 py-3 text-sm'>
                    <span className={`flex size-6 items-center justify-center rounded-md font-bold ${g.tone}`}>{g.sign === '+' ? '+' : '–'}</span>
                    <span className={`font-semibold ${g.tone.split(' ')[0]}`}>{g.label}</span>
                    <span className='text-muted-foreground'>· {g.hint}</span>
                  </p>
                  {visible.length === 0 ? (
                    <p className='text-muted-foreground border-t px-6 py-4 text-sm'>Belum ada komponen.</p>
                  ) : (
                    <ul className='divide-y border-t'>
                      {visible.map((c) => {
                        const i = list.findIndex((x) => x.id === c.id);
                        const used = usage(c.code);
                        return (
                          <li key={c.id} className={`flex flex-wrap items-center gap-4 px-6 py-4 ${c.is_active ? '' : 'opacity-60'}`}>
                            {!readOnly && !search && (
                              <div className='flex flex-col gap-1'>
                                <button
                                  type='button'
                                  disabled={busy || i === 0}
                                  onClick={() => move(c, -1)}
                                  aria-label={`Naikkan ${c.name}`}
                                  className='hover:bg-muted flex size-7 items-center justify-center rounded-md border disabled:opacity-30'
                                >
                                  <Icons.chevronUp className='size-4' />
                                </button>
                                <button
                                  type='button'
                                  disabled={busy || i === list.length - 1}
                                  onClick={() => move(c, 1)}
                                  aria-label={`Turunkan ${c.name}`}
                                  className='hover:bg-muted flex size-7 items-center justify-center rounded-md border disabled:opacity-30'
                                >
                                  <Icons.chevronDown className='size-4' />
                                </button>
                              </div>
                            )}
                            <div className='min-w-0 flex-1'>
                              <p className='flex flex-wrap items-center gap-2'>
                                <span className='font-semibold'>{c.name}</span>
                                <span className='bg-muted rounded px-1.5 py-0.5 font-mono text-xs'>{c.code}</span>
                                {c.is_reimbursement && (
                                  <span className='rounded bg-sky-500/10 px-1.5 py-0.5 text-xs font-medium text-sky-700 dark:text-sky-300'>Reimbursement</span>
                                )}
                                {c.is_taxable === false && (
                                  <span className='rounded bg-amber-500/10 px-1.5 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-300'>Tidak kena pajak</span>
                                )}
                              </p>
                              <p className='text-muted-foreground mt-0.5 text-sm'>
                                {CALC.find((x) => x.value === c.calculation_type)?.label ?? c.calculation_type} ·{' '}
                                {c.default_amount ? `default ${fmtRp(Number(c.default_amount))}` : 'tanpa nilai default'}
                                {g.value === 'EARNING_FIXED' && ` · ${used ? `dipakai di ${used} struktur gaji` : 'belum dipakai di struktur gaji'}`}
                              </p>
                            </div>
                            <label className='flex items-center gap-2 text-sm'>
                              <Switch checked={c.is_active} disabled={readOnly || busy} onCheckedChange={() => toggleActive(c)} />
                              {c.is_active ? 'Aktif' : 'Nonaktif'}
                            </label>
                            {!readOnly && (
                              <div className='flex items-center gap-2'>
                                <Button variant='outline' size='sm' onClick={() => openEdit(c)}>Edit</Button>
                                <Button
                                  variant='outline'
                                  size='icon-sm'
                                  className='text-destructive'
                                  onClick={() => handleDelete(c)}
                                  aria-label={`Hapus ${c.name}`}
                                >
                                  <Icons.trash />
                                </Button>
                              </div>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </section>
              );
            })
          )}
        </Card>
      </div>

      <Card className='gap-4 px-6 py-6 xl:sticky xl:top-20'>
        <div>
          <h3 className='text-lg font-semibold'>Urutan di slip gaji</h3>
          <p className='text-muted-foreground mt-0.5 text-sm'>
            Hanya komponen aktif.{readOnly ? '' : ' Ubah urutan dengan tombol panah di daftar.'}
          </p>
        </div>
        <div className='space-y-2 rounded-xl border border-dashed px-4 py-4 text-sm'>
          <p className='text-primary text-xs font-bold tracking-wide'>PENDAPATAN</p>
          {activeEarnings.length === 0 && <p className='text-muted-foreground'>—</p>}
          {activeEarnings.map((c) => (
            <p key={c.id} className='flex justify-between gap-2'>
              <span>{c.name}</span>
              <span className='text-muted-foreground'>+ Rp •••</span>
            </p>
          ))}
          <p className='pt-2 text-xs font-bold tracking-wide text-red-700 dark:text-red-300'>POTONGAN</p>
          {activeDeductions.length === 0 && <p className='text-muted-foreground'>—</p>}
          {activeDeductions.map((c) => (
            <p key={c.id} className='flex justify-between gap-2'>
              <span>{c.name}</span>
              <span className='text-muted-foreground'>− Rp •••</span>
            </p>
          ))}
          <p className='flex justify-between gap-2 border-t pt-3 font-semibold'>
            <span>Take home pay</span>
            <span>Rp •••</span>
          </p>
        </div>
      </Card>
    </div>
  );
}

// ---------- (2) Struktur gaji ----------

function StructureForm({
  initialEmployee,
  onClose,
  onSaved,
}: {
  /** Preselected employee (from "Atur struktur" / "Ubah gaji"). */
  initialEmployee?: number | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [components, setComponents] = useState<PayrollComponent[]>([]);
  const [form, setForm] = useState({
    employee: initialEmployee ? String(initialEmployee) : '',
    effective_from: '',
    basic_salary: '',
  });
  // ponytail: rows as {code, amount} strings; upgrade to typed form lib when structure form grows
  const [rows, setRows] = useState<{ code: string; amount: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    listEmployees({ page_size: '1000' }).then((p) => setEmployees(p.results)).catch(() => {});
    listComponents().then((c) =>
      setComponents(c.filter((x) => x.category === 'EARNING_FIXED' && x.is_active))
    ).catch(() => {});
  }, []);

  const fixedOptions = components.filter(
    (c) => !rows.some((r) => r.code === c.code)
  );
  const totalComponents = rows.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);

  function addRow() {
    setRows((r) => [...r, { code: '', amount: '' }]);
  }

  function updateRow(idx: number, patch: Partial<{ code: string; amount: string }>) {
    setRows((r) => r.map((row, i) => (i === idx ? { ...row, ...patch } : row)));
  }

  function removeRow(idx: number) {
    setRows((r) => r.filter((_, i) => i !== idx));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!form.employee || !form.effective_from || !form.basic_salary) {
      setError('Karyawan, Tanggal Efektif, dan Gaji Pokok wajib diisi.');
      return;
    }
    if (rows.some((r) => !r.code)) {
      setError('Pilih komponen untuk setiap baris.');
      return;
    }
    setSaving(true);
    try {
      await createStructure({
        employee: Number(form.employee),
        effective_from: form.effective_from,
        basic_salary: form.basic_salary,
        components: rows.map((r) => ({ code: r.code, amount: r.amount || '0' })),
      });
      onSaved();
    } catch (err) {
      setError(apiError(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{initialEmployee ? 'Struktur gaji (versi baru)' : 'Struktur gaji baru'}</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className='space-y-4'>
          {error && <p className='text-destructive text-sm'>{error}</p>}
          <div className='grid grid-cols-1 gap-4 md:grid-cols-3'>
            <div className='space-y-1.5'>
              <Label>Karyawan</Label>
              <select
                value={form.employee}
                onChange={(e) => setForm((f) => ({ ...f, employee: e.target.value }))}
                className='border-input h-8 w-full rounded-lg border bg-transparent px-2.5 text-sm'
              >
                <option value=''>Pilih Karyawan</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.employee_id} - {e.full_name}
                  </option>
                ))}
              </select>
            </div>
            <div className='space-y-1.5'>
              <Label>Tanggal Efektif</Label>
              <Input
                type='date'
                value={form.effective_from}
                onChange={(e) => setForm((f) => ({ ...f, effective_from: e.target.value }))}
              />
            </div>
            <div className='space-y-1.5'>
              <Label>Gaji Pokok</Label>
              <Input
                type='number'
                step='0.01'
                value={form.basic_salary}
                onChange={(e) => setForm((f) => ({ ...f, basic_salary: e.target.value }))}
              />
            </div>
          </div>

          <div className='space-y-2'>
            <div className='flex items-center justify-between'>
              <Label>Komponen tetap</Label>
              <Button type='button' variant='outline' size='sm' onClick={addRow}>
                <Icons.plusCircle />Tambah komponen
              </Button>
            </div>
            {rows.length === 0 && (
              <p className='text-muted-foreground text-sm'>
                Belum ada komponen tambahan. Gaji Pokok sudah termasuk di atas.
              </p>
            )}
            {rows.map((row, idx) => (
              <div key={idx} className='flex items-center gap-2'>
                <select
                  value={row.code}
                  onChange={(e) => updateRow(idx, { code: e.target.value })}
                  className='border-input h-8 flex-1 rounded-lg border bg-transparent px-2.5 text-sm'
                >
                  <option value=''>Pilih komponen</option>
                  {(fixedOptions.some((c) => c.code === row.code)
                    ? fixedOptions
                    : [...components.filter((c) => c.code === row.code), ...fixedOptions]
                  ).map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.name} ({c.code})
                    </option>
                  ))}
                </select>
                <Input
                  type='number'
                  step='0.01'
                  min='0'
                  placeholder='Nominal'
                  value={row.amount}
                  onChange={(e) => updateRow(idx, { amount: e.target.value })}
                  className='w-40'
                />
                <Button
                  type='button'
                  variant='ghost'
                  size='sm'
                  className='text-destructive'
                  onClick={() => removeRow(idx)}
                  aria-label='Hapus komponen'
                >
                  <Icons.trash />
                </Button>
              </div>
            ))}
            {rows.length > 0 && (
              <div className='text-muted-foreground flex justify-end gap-2 text-sm'>
                <span>Total Komponen:</span>
                <span className='text-foreground font-medium'>
                  Rp {totalComponents.toLocaleString('id')}
                </span>
              </div>
            )}
          </div>

          <div className='flex justify-end gap-2'>
            <Button type='button' variant='outline' onClick={onClose}>
              Batal
            </Button>
            <Button type='submit' disabled={saving}>
              {saving ? 'Menyimpan...' : 'Simpan'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function localIsoToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Structure in force today (latest effective_from that has started and not ended). */
function currentStructure(list: SalaryStructure[], today: string): SalaryStructure | null {
  return (
    list
      .filter((s) => s.is_active && s.effective_from <= today && (!s.effective_to || s.effective_to >= today))
      .sort((a, b) => b.effective_from.localeCompare(a.effective_from))[0] ?? null
  );
}

function StructuresSection({ readOnly = false }: { readOnly?: boolean }) {
  const [structures, setStructures] = useState<SalaryStructure[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<'ALL' | 'MISSING' | 'HAS'>('ALL');
  const [search, setSearch] = useState('');
  const [form, setForm] = useState<{ employee: number | null } | null>(null);
  const [history, setHistory] = useState<{ empId: number; empName: string; rows: SalaryStructure[] } | null>(null);
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  async function load() {
    setLoading(true);
    setError('');
    try {
      const [s, e] = await Promise.all([listStructures(), listEmployees({ page_size: '1000' })]);
      setStructures(s);
      setEmployees(e.results);
    } catch (err) {
      setError(apiError(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const today = localIsoToday();
  const rows = employees
    .filter((e) => e.employment_status === 'ACTIVE')
    .map((e) => {
      const own = structures.filter((s) => s.employee === e.id);
      return { employee: e, current: currentStructure(own, today), versions: own.length };
    })
    // Missing first, then by name (like the reference list).
    .sort((a, b) => Number(!!a.current) - Number(!!b.current) || a.employee.full_name.localeCompare(b.employee.full_name));
  const hasCount = rows.filter((r) => r.current).length;
  const missingCount = rows.length - hasCount;
  const visible = rows.filter((r) => {
    if (filter === 'MISSING' && r.current) return false;
    if (filter === 'HAS' && !r.current) return false;
    if (search && !`${r.employee.full_name} ${r.employee.employee_id}`.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  function openForm(employee: number | null) {
    setForm({ employee });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function showHistory(empId: number) {
    try {
      const list = await historyStructures(empId);
      const emp = employees.find((e) => e.id === empId);
      setHistory({ empId, empName: emp?.full_name ?? `#${empId}`, rows: list });
    } catch (err) {
      setError(apiError(err));
    }
  }

  async function handleDeactivate(s: SalaryStructure) {
    const raw = window.prompt(
      `Nonaktifkan struktur gaji ${s.employee_name} (berlaku ${s.effective_from})?\nTanggal berakhir (YYYY-MM-DD, kosongkan = kemarin):`,
      '',
    );
    if (raw === null) return;
    try {
      await deactivateStructure(s.id, raw || undefined);
      await load();
      if (history) await showHistory(history.empId);
    } catch (err) {
      setError(apiError(err));
    }
  }

  async function handleDelete(s: SalaryStructure) {
    if (!window.confirm(`Hapus permanen struktur gaji ${s.employee_name} (${s.effective_from})? Tindakan ini tidak dapat dibatalkan.`)) return;
    try {
      await deleteStructure(s.id);
      await load();
      if (history) await showHistory(history.empId);
    } catch (err) {
      setError(apiError(err));
    }
  }

  const pct = rows.length ? (hasCount / rows.length) * 100 : 0;

  return (
    <div className='grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_380px]'>
      <div className='flex min-w-0 flex-col gap-5'>
        {form && (
          <StructureForm
            key={form.employee ?? 'new'}
            initialEmployee={form.employee}
            onClose={() => setForm(null)}
            onSaved={() => { setForm(null); load(); }}
          />
        )}

        <Card className='flex-row flex-wrap items-center gap-5 px-6 py-5'>
          <p className='flex items-baseline gap-1.5'>
            <span className='text-4xl font-semibold tabular-nums'>{hasCount}</span>
            <span className='text-muted-foreground'>/ {rows.length} karyawan</span>
          </p>
          <div className='min-w-56 flex-1 space-y-1.5'>
            <p className='text-sm font-semibold'>Sudah punya struktur gaji berlaku</p>
            <div className='flex h-2.5 overflow-hidden rounded-full bg-amber-200 bg-[repeating-linear-gradient(135deg,transparent_0_6px,rgba(255,255,255,0.45)_6px_12px)] dark:bg-amber-500/30'>
              <div className='bg-primary h-full' style={{ width: `${pct}%` }} />
            </div>
            {missingCount > 0 ? (
              <p className='text-sm text-orange-700 dark:text-orange-300'>
                {missingCount} karyawan belum ikut payroll sampai struktur gajinya dibuat.
              </p>
            ) : (
              <p className='text-primary text-sm'>Semua karyawan aktif sudah punya struktur gaji.</p>
            )}
          </div>
          {missingCount > 0 && (
            <Button
              variant='outline'
              className='border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100 dark:bg-amber-500/10 dark:text-amber-200'
              onClick={() => setFilter('MISSING')}
            >
              Tampilkan yang belum ada
            </Button>
          )}
        </Card>

        {history && (
          <Card className='gap-0 overflow-hidden py-0'>
            <div className='flex items-center justify-between gap-2 px-6 py-4'>
              <h3 className='font-semibold'>Riwayat gaji · {history.empName}</h3>
              <Button variant='ghost' size='sm' onClick={() => setHistory(null)}>Tutup</Button>
            </div>
            <div className='overflow-x-auto border-t'>
              <table className='w-full text-sm'>
                <thead className='bg-muted/40 text-muted-foreground text-left'>
                  <tr>
                    <th className='px-6 py-2.5 font-medium'>Berlaku dari</th>
                    <th className='px-4 py-2.5 font-medium'>Sampai</th>
                    <th className='px-4 py-2.5 text-right font-medium'>Gaji pokok</th>
                    <th className='px-4 py-2.5 font-medium'>Status</th>
                    <th className='px-6 py-2.5' />
                  </tr>
                </thead>
                <tbody className='divide-y'>
                  {history.rows.map((r) => (
                    <tr key={r.id}>
                      <td className='px-6 py-3'>{fmtDay(r.effective_from)}</td>
                      <td className='px-4 py-3'>{r.effective_to ? fmtDay(r.effective_to) : 'Sekarang'}</td>
                      <td className='px-4 py-3 text-right font-medium tabular-nums'>{fmtRp(Number(r.basic_salary))}</td>
                      <td className='px-4 py-3'>
                        <Badge variant={r.is_active ? 'default' : 'secondary'}>{r.is_active ? 'Aktif' : 'Nonaktif'}</Badge>
                      </td>
                      <td className='px-6 py-3 text-right'>
                        <div className='flex justify-end gap-1'>
                          {!readOnly && r.is_active && !r.effective_to && (
                            <Button variant='ghost' size='sm' onClick={() => handleDeactivate(r)}>
                              <Icons.close />Nonaktifkan
                            </Button>
                          )}
                          {isAdmin && !readOnly && (
                            <Button variant='ghost' size='sm' className='text-destructive' onClick={() => handleDelete(r)}>
                              <Icons.trash />Hapus
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {history.rows.length === 0 && (
                    <tr>
                      <td colSpan={5} className='text-muted-foreground py-8 text-center'>Belum ada riwayat.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        <Card className='gap-0 overflow-hidden py-0'>
          <div className='flex flex-wrap items-center justify-between gap-3 px-6 py-5'>
            <h3 className='text-lg font-semibold'>Struktur gaji karyawan</h3>
            <div className='flex flex-wrap items-center gap-2'>
              <div className='bg-muted flex rounded-lg p-1' role='group' aria-label='Filter status struktur'>
                {(
                  [
                    ['ALL', `Semua · ${rows.length}`],
                    ['MISSING', `Belum ada · ${missingCount}`],
                    ['HAS', `Sudah ada · ${hasCount}`],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type='button'
                    aria-pressed={filter === value}
                    onClick={() => setFilter(value)}
                    className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
                      filter === value ? 'bg-background font-semibold shadow-sm' : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className='relative'>
                <Icons.search className='text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2' />
                <Input placeholder='Cari nama / ID' value={search} onChange={(e) => setSearch(e.target.value)} className='h-10 w-56 pl-9' />
              </div>
            </div>
          </div>
          {error && <p className='text-destructive border-t px-6 py-3 text-sm'>{error}</p>}
          {loading ? (
            <div className='space-y-2 border-t p-6'>
              {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className='h-12 w-full' />)}
            </div>
          ) : (
            <div className='overflow-x-auto border-t'>
              <table className='w-full text-sm'>
                <thead className='bg-muted/40 text-muted-foreground text-left'>
                  <tr>
                    <th className='px-6 py-3 font-medium'>Karyawan</th>
                    <th className='px-4 py-3 text-right font-medium'>Gaji pokok</th>
                    <th className='px-4 py-3 font-medium'>Komponen tetap</th>
                    <th className='px-4 py-3 font-medium'>Berlaku sejak</th>
                    <th className='px-4 py-3 font-medium'>Status</th>
                    <th className='px-6 py-3' />
                  </tr>
                </thead>
                <tbody className='divide-y'>
                  {visible.map(({ employee: e, current, versions }) => (
                    <tr key={e.id}>
                      <td className='px-6 py-3.5'>
                        <div className='flex items-center gap-3'>
                          <span
                            className={`flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                              current ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
                            }`}
                          >
                            {initialsOf(e.full_name)}
                          </span>
                          <span className='min-w-0'>
                            <span className='block font-medium'>{e.full_name}</span>
                            <span className='text-muted-foreground block font-mono text-xs'>{e.employee_id}</span>
                          </span>
                        </div>
                      </td>
                      <td className='px-4 py-3.5 text-right font-semibold whitespace-nowrap tabular-nums'>
                        {current ? fmtRp(Number(current.basic_salary)) : <span className='text-muted-foreground font-normal'>—</span>}
                      </td>
                      <td className='px-4 py-3.5'>
                        {current && current.components.length > 0 ? (
                          <span title={current.components.map((c) => `${c.name}: ${fmtRp(Number(c.amount))}`).join('\n')}>
                            {current.components.length} komponen ·{' '}
                            {fmtRp(current.components.reduce((sum, c) => sum + Number(c.amount || 0), 0))}
                          </span>
                        ) : (
                          <span className='text-muted-foreground'>—</span>
                        )}
                      </td>
                      <td className='px-4 py-3.5 whitespace-nowrap'>{current ? fmtDay(current.effective_from) : <span className='text-muted-foreground'>—</span>}</td>
                      <td className='px-4 py-3.5'>
                        {current ? (
                          <span className='bg-primary/10 text-primary inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium'>
                            <span className='bg-primary size-1.5 rounded-full' />Berlaku
                          </span>
                        ) : (
                          <span className='inline-flex items-center gap-1.5 rounded-full bg-orange-500/10 px-2.5 py-1 text-xs font-medium whitespace-nowrap text-orange-700 dark:text-orange-300'>
                            <Icons.warning className='size-3.5' />Belum ada
                          </span>
                        )}
                      </td>
                      <td className='px-6 py-3.5'>
                        <div className='flex justify-end gap-2'>
                          {versions > 0 && (
                            <Button variant='outline' size='sm' onClick={() => showHistory(e.id)}>
                              Riwayat · {versions}
                            </Button>
                          )}
                          {!readOnly &&
                            (current ? (
                              <Button variant='outline' size='sm' onClick={() => openForm(e.id)}>Ubah gaji</Button>
                            ) : (
                              <Button size='sm' onClick={() => openForm(e.id)}>Atur struktur</Button>
                            ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {visible.length === 0 && (
                    <tr>
                      <td colSpan={6} className='text-muted-foreground py-10 text-center'>Tidak ada karyawan yang cocok.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      <Card className='gap-4 px-6 py-6 xl:sticky xl:top-20'>
        <h3 className='text-lg font-semibold'>Atur struktur gaji</h3>
        {!readOnly && (
          <>
            <p className='text-muted-foreground text-sm'>
              Pilih <b className='text-foreground'>Atur struktur</b> atau <b className='text-foreground'>Ubah gaji</b> pada daftar, atau mulai dari sini.
            </p>
            <Button className='h-11 w-full' onClick={() => openForm(null)}>
              <Icons.add />Struktur gaji baru
            </Button>
          </>
        )}
        <div className='bg-muted/40 space-y-2 rounded-xl border px-4 py-4 text-sm'>
          <p>
            Perubahan gaji dibuat sebagai <b>versi baru</b>, bukan menimpa. Riwayat tetap tersimpan.
          </p>
          <p>Versi lama otomatis berakhir sehari sebelum tanggal efektif versi baru.</p>
          <p>Periode payroll yang sudah dikunci tidak ikut berubah.</p>
        </div>
      </Card>
    </div>
  );
}

// ---------- (3) Payroll Review ----------

const fmtRp = (n: number) => `Rp ${Number(n || 0).toLocaleString('id')}`;

// ---------- (3) Payroll Processing ----------

const MONTHS = [
  { value: 1, label: 'Januari' }, { value: 2, label: 'Februari' }, { value: 3, label: 'Maret' },
  { value: 4, label: 'April' }, { value: 5, label: 'Mei' }, { value: 6, label: 'Juni' },
  { value: 7, label: 'Juli' }, { value: 8, label: 'Agustus' }, { value: 9, label: 'September' },
  { value: 10, label: 'Oktober' }, { value: 11, label: 'November' }, { value: 12, label: 'Desember' },
];
const MONTHS_SHORT = ['JAN', 'FEB', 'MAR', 'APR', 'MEI', 'JUN', 'JUL', 'AGU', 'SEP', 'OKT', 'NOV', 'DES'];

// Period workflow in order (backend PayrollPeriod.Status).
const STEPS: { status: string; label: string }[] = [
  { status: 'DRAFT', label: 'Draf' },
  { status: 'CALCULATED', label: 'Dihitung' },
  { status: 'REVIEW', label: 'Direview' },
  { status: 'APPROVED', label: 'Disetujui' },
  { status: 'PAID', label: 'Dibayar' },
  { status: 'LOCKED', label: 'Dikunci' },
];

const NEXT_ACTION: Record<string, { action: string; label: string }> = {
  DRAFT: { action: 'calculate', label: 'Hitung payroll' },
  CALCULATED: { action: 'review', label: 'Tandai direview' },
  REVIEW: { action: 'approve', label: 'Setujui' },
  APPROVED: { action: 'mark-paid', label: 'Tandai dibayar' },
  PAID: { action: 'lock', label: 'Kunci periode' },
};

const periodName = (p: PayrollPeriod) => `${MONTHS.find((m) => m.value === p.period_month)?.label ?? ''} ${p.period_year}`;
const periodSlug = (p: PayrollPeriod) => `${p.period_year}-${String(p.period_month).padStart(2, '0')}`;
const isPaidUp = (p: PayrollPeriod) => p.status === 'PAID' || p.status === 'LOCKED';

function fmtDay(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
}

function initialsOf(name: string): string {
  return name.replace(/\([^)]*\)/g, '').split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('');
}

function PeriodStatusChip({ p }: { p: PayrollPeriod }) {
  const locked = p.status === 'LOCKED';
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${
        locked ? 'bg-foreground text-background' : p.status === 'DRAFT' ? 'bg-muted text-muted-foreground' : 'bg-primary/10 text-primary'
      }`}
    >
      {locked && <Icons.lock className='size-3' />}
      {locked ? 'Dikunci' : STEPS.find((s) => s.status === p.status)?.label ?? p.status_display}
    </span>
  );
}

function PeriodForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const year = new Date().getFullYear();
  const [form, setForm] = useState({ period_month: new Date().getMonth() + 1, period_year: year, period_start: '', period_end: '', notes: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const m = form.period_month;
    const y = form.period_year;
    const lastDay = new Date(y, m, 0).getDate();
    setForm((f) => ({
      ...f,
      period_start: `${y}-${String(m).padStart(2, '0')}-01`,
      period_end: `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`,
    }));
  }, [form.period_month, form.period_year]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      await createPeriod({
        period_month: form.period_month,
        period_year: form.period_year,
        period_start: form.period_start,
        period_end: form.period_end,
        notes: form.notes || undefined,
      });
      onSaved();
    } catch (err) {
      setError(apiError(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader><CardTitle>Buat Periode Baru</CardTitle></CardHeader>
      <CardContent>
        <form onSubmit={submit} className='space-y-4'>
          {error && <p className='text-destructive text-sm'>{error}</p>}
          <div className='grid grid-cols-1 gap-4 md:grid-cols-2'>
            <div className='space-y-1.5'>
              <Label>Bulan</Label>
              <select
                value={form.period_month}
                onChange={(e) => setForm((f) => ({ ...f, period_month: Number(e.target.value) }))}
                className='border-input h-8 w-full rounded-lg border bg-transparent px-2.5 text-sm'
              >
                {MONTHS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </div>
            <div className='space-y-1.5'>
              <Label>Tahun</Label>
              <Input type='number' value={form.period_year}
                onChange={(e) => setForm((f) => ({ ...f, period_year: Number(e.target.value) }))} />
            </div>
            <div className='space-y-1.5'>
              <Label>Tanggal Mulai</Label>
              <Input type='date' value={form.period_start} readOnly />
            </div>
            <div className='space-y-1.5'>
              <Label>Tanggal Akhir</Label>
              <Input type='date' value={form.period_end} readOnly />
            </div>
            <div className='space-y-1.5 md:col-span-2'>
              <Label>Catatan (opsional)</Label>
              <Input value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                placeholder='Catatan periode...' />
            </div>
          </div>
          <div className='flex justify-end gap-2'>
            <Button type='button' variant='outline' onClick={onClose}>Batal</Button>
            <Button type='submit' disabled={saving}>{saving ? 'Menyimpan...' : 'Simpan'}</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

/** Workflow progress: done steps filled, the current one highlighted. */
function PeriodStepper({ status }: { status: string }) {
  const current = STEPS.findIndex((s) => s.status === status);
  return (
    <ol className='grid grid-cols-3 gap-x-3 gap-y-3 sm:grid-cols-6'>
      {STEPS.map((s, i) => {
        const done = i <= current;
        return (
          <li key={s.status} className='space-y-2'>
            <div className={`h-1 rounded-full ${done ? 'bg-primary' : 'bg-muted'}`} />
            <p className={`flex items-center gap-1.5 text-sm ${done ? 'font-medium' : 'text-muted-foreground'}`}>
              {done ? (
                <span className='bg-primary text-primary-foreground flex size-5 items-center justify-center rounded-full'>
                  <Icons.check className='size-3' />
                </span>
              ) : (
                <span className='border-muted-foreground/40 size-5 rounded-full border-2' />
              )}
              {s.label}
            </p>
          </li>
        );
      })}
    </ol>
  );
}

/** Per-employee breakdown (review data) with expandable components + manual items. */
function PayrollBreakdown({
  period,
  data,
  components,
  readOnly,
  onChanged,
}: {
  period: PayrollPeriod;
  data: ReviewData;
  components: PayrollComponent[];
  readOnly: boolean;
  onChanged: () => void;
}) {
  const [expanded, setExpanded] = useState<number | null>(null);
  const [editingCode, setEditingCode] = useState('');
  const [amountInput, setAmountInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const canEditManual = !readOnly && period.status !== 'LOCKED';
  const manualComps = components.filter((c) => c.category === 'EARNING_VARIABLE' || c.category === 'DEDUCTION');
  const s = data.summary;

  async function addManual(payrollId: number) {
    if (!editingCode || !amountInput || Number(amountInput) <= 0) return;
    setBusy(true);
    setError('');
    try {
      await addManualItem(payrollId, editingCode, amountInput);
      setEditingCode('');
      setAmountInput('');
      onChanged();
    } catch (err) { setError(apiError(err)); }
    finally { setBusy(false); }
  }

  async function removeManual(payrollId: number, code: string) {
    if (!window.confirm(`Hapus item manual ${code}?`)) return;
    setBusy(true);
    setError('');
    try {
      await removeManualItem(payrollId, code);
      onChanged();
    } catch (err) { setError(apiError(err)); }
    finally { setBusy(false); }
  }

  return (
    <Card className='gap-0 overflow-hidden py-0'>
      <div className='flex flex-wrap items-center justify-between gap-2 px-6 py-5'>
        <h3 className='text-lg font-semibold'>Rincian per karyawan</h3>
        <p className='text-muted-foreground text-sm'>Klik baris untuk komponen gaji</p>
      </div>
      {error && <p className='text-destructive border-t px-6 py-3 text-sm'>{error}</p>}
      <div className='overflow-x-auto border-t'>
        <table className='w-full text-sm'>
          <thead className='bg-muted/40 text-muted-foreground'>
            <tr>
              <th className='px-6 py-3 text-left font-medium'>Karyawan</th>
              <th className='px-4 py-3 text-right font-medium'>Gross</th>
              <th className='px-4 py-3 text-right font-medium'>PPh 21</th>
              <th className='px-4 py-3 text-right font-medium'>Potongan</th>
              <th className='text-foreground px-4 py-3 text-right font-semibold'>THP</th>
              <th className='text-foreground px-4 py-3 text-right font-semibold'>Transfer</th>
              <th className='px-6 py-3' />
            </tr>
          </thead>
          <tbody>
            {data.employees.map((row) => {
              const open = expanded === row.payroll_id;
              return (
                <Fragment key={row.payroll_id}>
                  <tr
                    className='hover:bg-muted/40 cursor-pointer border-t'
                    onClick={() => { setExpanded(open ? null : row.payroll_id); setEditingCode(''); setAmountInput(''); }}
                  >
                    <td className='px-6 py-4'>
                      <div className='flex items-center gap-3'>
                        <Icons.chevronRight className={`text-muted-foreground size-4 shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} />
                        <span className='bg-muted text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold'>
                          {initialsOf(row.employee_name)}
                        </span>
                        <span className='font-medium'>{row.employee_name}</span>
                        {row.is_dtp && (
                          <span className='rounded bg-blue-500/10 px-1.5 py-0.5 text-[11px] font-semibold text-blue-700 dark:text-blue-300' title='PPh 21 ditanggung pemerintah'>
                            DTP
                          </span>
                        )}
                      </div>
                    </td>
                    <td className='px-4 py-4 text-right tabular-nums'>{fmtRp(row.gross_salary)}</td>
                    <td className='text-muted-foreground px-4 py-4 text-right tabular-nums'>{fmtRp(row.pph21)}</td>
                    <td className='text-muted-foreground px-4 py-4 text-right tabular-nums'>{fmtRp(row.total_deduction)}</td>
                    <td className='px-4 py-4 text-right font-semibold tabular-nums'>{fmtRp(row.net_salary)}</td>
                    <td className='text-primary px-4 py-4 text-right font-semibold tabular-nums'>{fmtRp(row.transfer_amount)}</td>
                    <td className='px-6 py-4 text-right' onClick={(e) => e.stopPropagation()}>
                      {isPaidUp(period) && (
                        <Button
                          variant='outline'
                          size='sm'
                          onClick={() =>
                            downloadPayslip(row.payroll_id, `${row.employee_name} ${periodSlug(period)}`)
                              .catch(() => toast.error('Slip gaji hanya tersedia setelah periode dibayar (PAID/LOCKED).'))
                          }
                        >
                          <Icons.download />Slip
                        </Button>
                      )}
                    </td>
                  </tr>
                  {open && (
                    <tr className='bg-muted/30'>
                      <td colSpan={7} className='px-6 py-4'>
                        <table className='w-full text-sm'>
                          <thead className='text-muted-foreground text-xs'>
                            <tr>
                              <th className='py-1.5 text-left font-medium'>Komponen</th>
                              <th className='py-1.5 text-left font-medium'>Kategori</th>
                              <th className='py-1.5 text-left font-medium'>Sumber</th>
                              <th className='py-1.5 text-right font-medium'>Jumlah</th>
                              {canEditManual && <th className='w-10' />}
                            </tr>
                          </thead>
                          <tbody className='divide-y'>
                            {row.items.map((it) => (
                              <tr key={it.id}>
                                <td className='py-2'>
                                  {it.component_name}
                                  {it.description && <span className='text-muted-foreground block text-xs'>{it.description}</span>}
                                </td>
                                <td className='py-2'>
                                  <Badge variant='outline'>
                                    {it.category === 'DEDUCTION' ? 'Potongan' : it.category === 'EARNING_FIXED' ? 'Tetap' : 'Variabel'}
                                  </Badge>
                                </td>
                                <td className='py-2 text-xs'>{it.source === 'SYSTEM' ? 'Sistem' : 'Manual'}</td>
                                <td className='py-2 text-right tabular-nums'>{fmtRp(Number(it.amount))}</td>
                                {canEditManual && (
                                  <td className='py-2 text-right'>
                                    {it.source === 'MANUAL' && (
                                      <button
                                        type='button'
                                        disabled={busy}
                                        onClick={() => removeManual(row.payroll_id, it.component_code)}
                                        className='text-destructive hover:underline disabled:opacity-50'
                                        aria-label={`Hapus item manual ${it.component_code}`}
                                      >
                                        <Icons.close className='size-4' />
                                      </button>
                                    )}
                                  </td>
                                )}
                              </tr>
                            ))}
                            {row.items.length === 0 && (
                              <tr>
                                <td colSpan={canEditManual ? 5 : 4} className='text-muted-foreground py-4 text-center'>Tidak ada item.</td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                        {canEditManual && (
                          <div className='mt-3 flex flex-wrap items-center gap-2'>
                            <span className='text-muted-foreground text-xs'>Tambah item manual:</span>
                            <select
                              value={editingCode}
                              onChange={(e) => { setEditingCode(e.target.value); setAmountInput(''); }}
                              className='border-input bg-background h-8 rounded-lg border px-2 text-sm'
                            >
                              <option value=''>Pilih komponen</option>
                              {manualComps.map((c) => <option key={c.id} value={c.code}>{c.code} · {c.name}</option>)}
                            </select>
                            {editingCode && (
                              <>
                                <Input
                                  type='number' min='0' step='1' value={amountInput}
                                  onChange={(e) => setAmountInput(e.target.value)}
                                  className='h-8 w-36' placeholder='Jumlah'
                                />
                                <Button size='sm' disabled={busy || !amountInput} onClick={() => addManual(row.payroll_id)}>
                                  Tambah
                                </Button>
                              </>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {data.employees.length === 0 && (
              <tr>
                <td colSpan={7} className='text-muted-foreground border-t py-10 text-center'>Belum ada data payroll di periode ini.</td>
              </tr>
            )}
          </tbody>
          {data.employees.length > 0 && (
            <tfoot className='border-t font-semibold'>
              <tr>
                <td className='px-6 py-4'>Total · {s.employee_count} karyawan</td>
                <td className='px-4 py-4 text-right tabular-nums'>{fmtRp(s.total_gross)}</td>
                <td className='px-4 py-4 text-right tabular-nums'>{fmtRp(s.total_pph21)}</td>
                <td className='px-4 py-4 text-right tabular-nums'>{fmtRp(s.total_deduction)}</td>
                <td className='px-4 py-4 text-right tabular-nums'>{fmtRp(s.total_thp)}</td>
                <td className='text-primary px-4 py-4 text-right tabular-nums'>{fmtRp(s.total_transfer)}</td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </Card>
  );
}

/** Selected period: header + actions, workflow stepper, totals, eligibility, breakdown. */
function PeriodDetail({
  period,
  readOnly,
  isAdmin,
  onUpdated,
  onDeleted,
  onGoToStructures,
  onNotReady,
}: {
  period: PayrollPeriod;
  readOnly: boolean;
  isAdmin: boolean;
  onUpdated: (p: PayrollPeriod) => void;
  onDeleted: (p: PayrollPeriod) => void;
  onGoToStructures: () => void;
  onNotReady: (n: number) => void;
}) {
  const [data, setData] = useState<ReviewData | null>(null);
  const [eligibility, setEligibility] = useState<EligibilityData | null>(null);
  const [components, setComponents] = useState<PayrollComponent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [acting, setActing] = useState(false);
  const [showNames, setShowNames] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    Promise.all([
      // Draft periods have no payroll rows yet; review only after "Hitung".
      period.status === 'DRAFT' ? Promise.resolve(null) : getPeriodReview(period.id),
      getPeriodEligibility(period.id).catch(() => null),
      readOnly ? Promise.resolve([] as PayrollComponent[]) : listComponents().catch(() => [] as PayrollComponent[]),
    ])
      .then(([review, elig, comps]) => {
        if (cancelled) return;
        setData(review);
        setEligibility(elig);
        setComponents(comps);
        if (elig) onNotReady(elig.not_ready_count);
      })
      .catch((err) => { if (!cancelled) setError(apiError(err)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period.id, period.status, refreshKey]);

  async function run(fn: () => Promise<PayrollPeriod>) {
    setActing(true);
    setActionError('');
    try {
      onUpdated(await fn());
      setRefreshKey((k) => k + 1);
    } catch (err) { setActionError(apiError(err)); }
    finally { setActing(false); }
  }

  async function handleDelete() {
    if (!window.confirm(`Hapus periode ${periodName(period)}? Data payroll akan ikut terhapus.`)) return;
    try {
      await deletePeriod(period.id);
      onDeleted(period);
    } catch (err) { setActionError(apiError(err)); }
  }

  const next = NEXT_ACTION[period.status];
  const canRecalculate = period.status === 'CALCULATED' || period.status === 'REVIEW';
  const s = data?.summary;
  const stats = s
    ? [
        { label: 'Karyawan', value: String(s.employee_count) },
        { label: 'Total gross', value: fmtRp(s.total_gross) },
        { label: 'PPh 21', value: fmtRp(s.total_pph21) },
        { label: 'Potongan', value: fmtRp(s.total_deduction) },
        { label: 'Total THP', value: fmtRp(s.total_thp) },
        { label: 'Total transfer', value: fmtRp(s.total_transfer), highlight: true },
      ]
    : [];

  return (
    <div className='flex min-w-0 flex-col gap-5'>
      <Card className='gap-5 px-6 py-6'>
        <div className='flex flex-wrap items-start justify-between gap-3'>
          <div>
            <h3 className='text-2xl font-semibold tracking-tight'>Periode {periodName(period)}</h3>
            <p className='text-muted-foreground mt-1'>
              {Number(period.period_start.slice(8, 10))} – {Number(period.period_end.slice(8, 10))}{' '}
              {MONTHS.find((m) => m.value === period.period_month)?.label} {period.period_year}
            </p>
          </div>
          <div className='flex flex-wrap items-center gap-2'>
            {!readOnly && canRecalculate && (
              <Button variant='outline' disabled={acting} onClick={() => run(() => recalculatePeriod(period.id))} title='Hitung ulang & tambahkan karyawan baru'>
                <Icons.refresh />Sync
              </Button>
            )}
            {isPaidUp(period) && (
              <Button
                variant='outline'
                onClick={() => downloadRecap(period.id, periodSlug(period)).catch(() => toast.error('Gagal mengunduh rekap payroll.'))}
              >
                <Icons.download />Unduh rekap
              </Button>
            )}
            {!readOnly && next && (
              <Button disabled={acting} onClick={() => run(() => transitionPeriod(period.id, next.action))}>
                {acting ? <Icons.spinner className='animate-spin' /> : <Icons.check />}
                {next.label}
              </Button>
            )}
            {!readOnly && (isAdmin || period.status !== 'LOCKED') && (
              <Button variant='ghost' size='icon' className='text-destructive' onClick={handleDelete} aria-label='Hapus periode' title='Hapus periode'>
                <Icons.trash />
              </Button>
            )}
          </div>
        </div>
        {actionError && <p className='text-destructive text-sm'>{actionError}</p>}
        <PeriodStepper status={period.status} />
        {loading ? (
          <Skeleton className='h-20 w-full' />
        ) : error ? (
          <p className='text-destructive text-sm'>{error}</p>
        ) : stats.length > 0 ? (
          <div className='grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6'>
            {stats.map((st) => (
              <div
                key={st.label}
                className={`min-w-0 rounded-xl border px-4 py-3.5 ${st.highlight ? 'border-primary/30 bg-primary/5' : 'bg-muted/30'}`}
              >
                <p className={`truncate text-lg font-semibold tabular-nums ${st.highlight ? 'text-primary' : ''}`} title={st.value}>
                  {st.value}
                </p>
                <p className='text-muted-foreground text-sm'>{st.label}</p>
              </div>
            ))}
          </div>
        ) : (
          <p className='text-muted-foreground rounded-xl border border-dashed px-4 py-4 text-sm'>
            Periode masih draf. {readOnly ? 'Payroll belum dihitung oleh HR.' : 'Klik “Hitung payroll” untuk membuat rincian gaji karyawan.'}
          </p>
        )}
      </Card>

      {eligibility && eligibility.not_ready_count > 0 && (
        <div className='rounded-xl border border-amber-300 bg-amber-50 px-5 py-4 text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200'>
          <div className='flex flex-wrap items-center gap-3'>
            <Icons.warning className='size-5 shrink-0' />
            <p className='min-w-0 flex-1 font-medium'>
              {eligibility.not_ready_count} karyawan tidak ikut payroll periode ini karena belum punya struktur gaji
            </p>
            <Button variant='outline' size='sm' className='bg-background' onClick={() => setShowNames((v) => !v)}>
              {showNames ? 'Sembunyikan nama' : 'Lihat nama'}
            </Button>
            {!readOnly && (
              <Button size='sm' className='bg-amber-700 text-white hover:bg-amber-800' onClick={onGoToStructures}>
                Atur struktur gaji
              </Button>
            )}
          </div>
          {showNames && (
            <p className='mt-3 text-sm'>
              {eligibility.not_ready.map((e) => `${e.full_name} (${e.employee_id})`).join(', ')}
            </p>
          )}
        </div>
      )}

      {data && (
        <PayrollBreakdown
          period={period}
          data={data}
          components={components}
          readOnly={readOnly}
          onChanged={() => setRefreshKey((k) => k + 1)}
        />
      )}
    </div>
  );
}

function PayrollProcessingSection({
  readOnly = false,
  onGoToStructures,
  onNotReady,
}: {
  readOnly?: boolean;
  onGoToStructures: () => void;
  onNotReady: (n: number) => void;
}) {
  const [periods, setPeriods] = useState<PayrollPeriod[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  async function load(selectNewest = false) {
    setLoading(true); setError('');
    try {
      const list = await listPeriods();
      setPeriods(list);
      setSelectedId((cur) => (selectNewest || cur === null || !list.some((p) => p.id === cur) ? list[0]?.id ?? null : cur));
    } catch (err) { setError(apiError(err)); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  const selected = periods.find((p) => p.id === selectedId) ?? null;

  return (
    <div className='grid grid-cols-1 items-start gap-6 lg:grid-cols-[320px_minmax(0,1fr)]'>
      <div className='flex flex-col gap-3 lg:sticky lg:top-20'>
        <div className='flex items-center justify-between gap-2'>
          <h3 className='text-lg font-semibold'>Periode</h3>
          {!readOnly && (
            <Button onClick={() => setShowForm(true)} disabled={showForm}>
              <Icons.add />Buat periode
            </Button>
          )}
        </div>
        {showForm && (
          <PeriodForm onClose={() => setShowForm(false)} onSaved={() => { setShowForm(false); load(true); }} />
        )}
        {error && <p className='text-destructive text-sm'>{error}</p>}
        {loading && periods.length === 0 ? (
          Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className='h-24 w-full rounded-xl' />)
        ) : periods.length === 0 ? (
          <p className='text-muted-foreground rounded-xl border border-dashed px-4 py-8 text-center text-sm'>
            Belum ada periode. Buat periode baru untuk memulai.
          </p>
        ) : (
          <ul className='flex flex-col gap-2'>
            {periods.map((p) => (
              <li key={p.id}>
                <button
                  type='button'
                  onClick={() => setSelectedId(p.id)}
                  aria-current={p.id === selectedId}
                  className={`bg-card flex w-full items-center gap-3 rounded-xl border px-4 py-4 text-left transition-colors ${
                    p.id === selectedId ? 'border-foreground ring-foreground ring-1' : 'hover:bg-muted/40'
                  }`}
                >
                  <span className='bg-muted flex size-12 shrink-0 flex-col items-center justify-center rounded-lg leading-tight'>
                    <span className='text-muted-foreground text-[11px] font-medium'>{MONTHS_SHORT[p.period_month - 1]}</span>
                    <span className='font-semibold tabular-nums'>{String(p.period_year).slice(-2)}</span>
                  </span>
                  <span className='min-w-0 flex-1'>
                    <span className='block font-semibold'>{periodName(p)}</span>
                    <span className='text-muted-foreground block text-sm'>
                      {p.payroll_count} karyawan · dibuat {p.created_at ? fmtDay(p.created_at) : '-'}
                    </span>
                  </span>
                  <PeriodStatusChip p={p} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {selected ? (
        <PeriodDetail
          key={selected.id}
          period={selected}
          readOnly={readOnly}
          isAdmin={isAdmin}
          onUpdated={(u) => setPeriods((prev) => prev.map((p) => (p.id === u.id ? u : p)))}
          onDeleted={() => load(true)}
          onGoToStructures={onGoToStructures}
          onNotReady={onNotReady}
        />
      ) : (
        !loading && (
          <Card className='items-center px-6 py-14 text-center'>
            <Icons.wallet className='text-muted-foreground size-8' />
            <p className='mt-2 font-semibold'>Pilih atau buat periode payroll</p>
          </Card>
        )
      )}
    </div>
  );
}

// ---------- (4) Tax Config (Tahap 3a/3b UI) ----------

function TaxConfigSection({ readOnly = false }: { readOnly?: boolean }) {
  const [configs, setConfigs] = useState<TaxConfig[]>([]);
  const [profiles, setProfiles] = useState<EmployeeTaxProfile[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [profileSearch, setProfileSearch] = useState('');
  const [onlyMissing, setOnlyMissing] = useState(false);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const [c, p, e] = await Promise.all([
        listTaxConfigs(),
        listTaxProfiles(),
        listEmployees({ page_size: '1000' }),
      ]);
      setConfigs(c);
      setProfiles(p);
      setEmployees(e.results);
      setSelectedId((prev) => prev ?? c.find((x) => x.is_active)?.id ?? c[0]?.id ?? null);
    } catch (err) {
      setError(apiError(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const selected = configs.find((c) => c.id === selectedId) ?? null;

  async function toggleActive(config: TaxConfig) {
    setError('');
    try {
      await updateTaxConfig(config.id, { is_active: !config.is_active });
      load();
    } catch (err) {
      setError(apiError(err));
    }
  }

  return (
    <div className='flex flex-col gap-5'>
      {error && <p className='text-destructive text-sm'>{error}</p>}
      {loading ? (
        <div className='space-y-2'>
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className='h-24 w-full' />)}
        </div>
      ) : configs.length === 0 ? (
        <Card>
          <CardContent className='flex flex-col items-center gap-2 py-12 text-center'>
            <Icons.info className='text-muted-foreground h-8 w-8' />
            <p className='font-medium'>Belum ada konfigurasi pajak</p>
            <p className='text-muted-foreground max-w-md text-sm'>
              Payroll tidak dapat dihitung tanpa konfigurasi pajak aktif. Jalankan
              <code className='bg-muted mx-1 rounded px-1 py-0.5 text-xs'>seed_tax_config</code>
              di server, lalu muat ulang halaman ini.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className='flex flex-wrap items-center gap-3'>
            <label className='bg-card flex h-10 items-center gap-2 rounded-lg border px-3 text-sm'>
              <span className='text-muted-foreground'>Tahun pajak</span>
              <select
                value={selectedId ?? ''}
                onChange={(e) => setSelectedId(Number(e.target.value))}
                className='bg-transparent font-semibold outline-none'
              >
                {configs.map((c) => (
                  <option key={c.id} value={c.id}>{c.year}</option>
                ))}
              </select>
            </label>
            {selected && (
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${
                  selected.is_active ? 'bg-primary/10 text-primary' : 'bg-amber-500/10 text-amber-700 dark:text-amber-300'
                }`}
              >
                <span className='size-1.5 rounded-full bg-current' />
                {selected.is_active ? 'Konfigurasi aktif' : 'Belum aktif — payroll tahun ini belum memakai konfigurasi ini'}
              </span>
            )}
            {selected && !readOnly && (
              <Button variant='outline' size='sm' onClick={() => toggleActive(selected)}>
                {selected.is_active ? 'Nonaktifkan' : 'Aktifkan'}
              </Button>
            )}
          </div>
          {selected && <TaxConfigDetail key={selected.id} config={selected} onChanged={load} readOnly={readOnly} />}
          <TaxProfilesCard
            profiles={profiles}
            employees={employees}
            search={profileSearch}
            setSearch={setProfileSearch}
            onlyMissing={onlyMissing}
            setOnlyMissing={setOnlyMissing}
            onChanged={load}
            readOnly={readOnly}
          />
        </>
      )}
    </div>
  );
}

const DEFAULT_LAYER_LIMITS = [60_000_000, 250_000_000, 500_000_000, 5_000_000_000];
const DEFAULT_LAYER_RATES = [5, 15, 25, 30, 35];

function fmtPct(v: string | number): string {
  return `${Number(v).toLocaleString('id-ID', { maximumFractionDigits: 2 })}%`;
}

function TaxConfigDetail({ config, onChanged, readOnly = false }: { config: TaxConfig; onChanged: () => void; readOnly?: boolean }) {
  const [dtp, setDtp] = useState(String(Number(config.dtp_threshold)));
  const [layerLimits, setLayerLimits] = useState(
    (config.annual_layer_limits ?? []).map((v) => String(Number(v))),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [terCat, setTerCat] = useState<'A' | 'B' | 'C'>('A');
  const [showAllTer, setShowAllTer] = useState(false);
  const [editTer, setEditTer] = useState(false);
  const [editLayers, setEditLayers] = useState(false);

  async function saveGeneral(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      await updateTaxConfig(config.id, { dtp_threshold: dtp });
      onChanged();
    } catch (err) {
      setError(apiError(err));
    } finally {
      setSaving(false);
    }
  }

  async function saveLayers() {
    setError('');
    setSaving(true);
    try {
      await updateTaxConfig(config.id, {
        annual_layer_limits: layerLimits.map((v) => v || null),
      });
      onChanged();
    } catch (err) {
      setError(apiError(err));
    } finally {
      setSaving(false);
    }
  }

  // Effective annual layers: full override rows, else (custom or default) limits @ statutory rates.
  const overridden = config.annual_brackets.length > 0;
  const limits = DEFAULT_LAYER_LIMITS.map((d, i) => Number(config.annual_layer_limits?.[i] ?? 0) || d);
  const layers = overridden
    ? [...config.annual_brackets]
        .sort((a, b) => a.layer_order - b.layer_order)
        .map((b) => ({ lower: Number(b.pkp_lower), upper: b.pkp_upper === null ? null : Number(b.pkp_upper), rate: Number(b.rate_pct) }))
    : DEFAULT_LAYER_RATES.map((rate, i) => ({ lower: i === 0 ? 0 : limits[i - 1], upper: i < limits.length ? limits[i] : null, rate }));
  const customLimits = !overridden && (config.annual_layer_limits ?? []).some((v) => v !== null && v !== '');

  const terRows = config.ter_brackets
    .filter((b) => b.ter_category === terCat)
    .sort((a, b) => Number(a.bruto_lower) - Number(b.bruto_lower));
  const shownTer = showAllTer ? terRows : terRows.slice(0, 7);
  const maxRate = Math.max(...shownTer.map((b) => Number(b.rate_pct)), 0.0001);

  return (
    <div className='flex flex-col gap-5'>
      <div className='grid gap-5 lg:grid-cols-2'>
        <Card className='gap-4 px-6 py-6'>
          <h3 className='text-lg font-semibold'>PPh 21 DTP (ditanggung pemerintah)</h3>
          <form onSubmit={saveGeneral} className='space-y-3'>
            {error && <p className='text-destructive text-sm'>{error}</p>}
            <div className='space-y-1.5'>
              <Label htmlFor='dtp-threshold'>Ambang THP</Label>
              <div className='border-input focus-within:border-ring focus-within:ring-ring/50 flex h-11 items-center gap-2 rounded-lg border px-3 focus-within:ring-3'>
                <span className='text-muted-foreground text-sm'>Rp</span>
                <input
                  id='dtp-threshold'
                  inputMode='numeric'
                  value={dtp ? Number(dtp).toLocaleString('id-ID') : ''}
                  disabled={readOnly}
                  onChange={(e) => setDtp(e.target.value.replace(/\D/g, ''))}
                  className='w-full bg-transparent tabular-nums outline-none'
                />
              </div>
              <p className='text-muted-foreground text-xs'>Jika THP ≤ ambang, PPh 21 tidak dipotong dari transfer.</p>
            </div>
            {!readOnly && (
              <div className='flex justify-end'>
                <Button type='submit' disabled={saving}>{saving ? 'Menyimpan...' : 'Simpan'}</Button>
              </div>
            )}
          </form>
        </Card>

        <Card className='gap-4 px-6 py-6'>
          <div className='flex items-center justify-between gap-2'>
            <h3 className='text-lg font-semibold'>Lapisan tarif tahunan (Pasal 17)</h3>
            <span className='bg-muted rounded-full px-2.5 py-1 text-xs font-medium'>
              {overridden ? 'Override' : customLimits ? 'Batas kustom' : 'Statutory'}
            </span>
          </div>
          <table className='w-full text-sm'>
            <thead className='text-muted-foreground text-xs'>
              <tr className='border-b'>
                <th className='py-2 text-left font-medium'>Penghasilan kena pajak per tahun</th>
                <th className='py-2 text-right font-medium'>Tarif</th>
              </tr>
            </thead>
            <tbody className='divide-y'>
              {layers.map((l, i) => (
                <tr key={i}>
                  <td className='py-2.5 tabular-nums'>
                    {l.upper === null ? `> ${fmtRp(l.lower)}` : `${fmtRp(l.lower)} – ${fmtRp(l.upper)}`}
                  </td>
                  <td className='py-2.5 text-right font-semibold'>{fmtPct(l.rate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!readOnly && (
            <div className='flex justify-end'>
              <Button variant='outline' size='sm' onClick={() => setEditLayers((v) => !v)}>
                {editLayers ? 'Tutup editor' : 'Override lapisan'}
              </Button>
            </div>
          )}
        </Card>
      </div>

      {editLayers && !readOnly && (
        <div className='grid gap-5 lg:grid-cols-2'>
          <Card className='gap-3 px-6 py-6'>
            <h3 className='font-semibold'>Batas lapisan (tarif statutory)</h3>
            <p className='text-muted-foreground text-sm'>
              Default: 60 jt / 250 jt / 500 jt / 5 M @ 5/15/25/30/35%. Kosongkan untuk kembali ke default.
            </p>
            <div className='grid grid-cols-2 gap-3 sm:grid-cols-4'>
              {layerLimits.map((v, i) => (
                <div key={i} className='space-y-1.5'>
                  <Label className='text-xs'>Lapisan {i + 1} → {i + 2}</Label>
                  <Input
                    type='number'
                    min='0'
                    value={v}
                    onChange={(e) => setLayerLimits((prev) => prev.map((p, j) => (j === i ? e.target.value : p)))}
                  />
                </div>
              ))}
            </div>
            <div className='flex justify-end'>
              <Button onClick={saveLayers} disabled={saving}>{saving ? 'Menyimpan...' : 'Simpan batas'}</Button>
            </div>
          </Card>
          <AnnualBracketsCard config={config} onChanged={onChanged} readOnly={readOnly} />
        </div>
      )}

      <Card className='gap-0 overflow-hidden py-0'>
        <div className='flex flex-wrap items-start justify-between gap-3 px-6 py-5'>
          <div>
            <h3 className='text-lg font-semibold'>Tarif efektif rata-rata (TER) bulanan</h3>
            <p className='text-muted-foreground mt-0.5 text-sm'>Kategori ditentukan dari status PTKP karyawan.</p>
          </div>
          <div className='bg-muted flex rounded-lg p-1' role='group' aria-label='Kategori TER'>
            {(['A', 'B', 'C'] as const).map((c) => (
              <button
                key={c}
                type='button'
                aria-pressed={terCat === c}
                onClick={() => setTerCat(c)}
                className={`rounded-md px-3.5 py-1.5 text-sm transition-colors ${
                  terCat === c ? 'bg-background font-semibold shadow-sm' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Kategori {c}
              </button>
            ))}
          </div>
        </div>
        {terRows.length === 0 ? (
          <p className='text-muted-foreground border-t px-6 py-8 text-center text-sm'>Belum ada tarif untuk kategori {terCat}.</p>
        ) : (
          <table className='w-full border-t text-sm'>
            <thead className='bg-muted/40 text-muted-foreground text-left'>
              <tr>
                <th className='px-6 py-3 font-medium'>Penghasilan bruto per bulan</th>
                <th className='px-4 py-3 text-right font-medium'>Tarif</th>
                <th className='hidden w-2/5 px-6 py-3 sm:table-cell' />
              </tr>
            </thead>
            <tbody className='divide-y'>
              {shownTer.map((b) => (
                <tr key={b.id}>
                  <td className='px-6 py-3 tabular-nums'>
                    {b.bruto_upper === null
                      ? `> ${fmtRp(Number(b.bruto_lower))}`
                      : `${fmtRp(Number(b.bruto_lower))} – ${fmtRp(Number(b.bruto_upper))}`}
                  </td>
                  <td className='px-4 py-3 text-right font-semibold tabular-nums'>{fmtPct(b.rate_pct)}</td>
                  <td className='hidden px-6 py-3 sm:table-cell'>
                    <div className='bg-muted h-1.5 overflow-hidden rounded-full'>
                      <div
                        className='bg-primary h-full rounded-full'
                        style={{ width: `${Math.max(2, (Number(b.rate_pct) / maxRate) * 100)}%` }}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className='text-muted-foreground flex flex-wrap items-center justify-between gap-2 border-t px-6 py-3.5 text-sm'>
          <span>
            {showAllTer || terRows.length <= 7
              ? `${terRows.length} baris kategori ${terCat}.`
              : `Menampilkan 7 dari ${terRows.length} baris kategori ${terCat}.`}
          </span>
          <div className='flex gap-2'>
            {terRows.length > 7 && (
              <Button variant='ghost' size='sm' onClick={() => setShowAllTer((v) => !v)}>
                {showAllTer ? 'Tampilkan sedikit' : 'Tampilkan semua'}
              </Button>
            )}
            {!readOnly && (
              <Button variant='outline' size='sm' onClick={() => setEditTer((v) => !v)}>
                {editTer ? 'Tutup editor' : 'Edit tabel'}
              </Button>
            )}
          </div>
        </div>
      </Card>

      {editTer && !readOnly && <TerBracketsCard config={config} onChanged={onChanged} readOnly={readOnly} />}
    </div>
  );
}

function TerBracketsCard({ config, onChanged, readOnly = false }: { config: TaxConfig; onChanged: () => void; readOnly?: boolean }) {
  const [rows, setRows] = useState(
    config.ter_brackets.map((b) => ({
      ter_category: b.ter_category,
      bruto_lower: String(Number(b.bruto_lower)),
      bruto_upper: b.bruto_upper === null ? '' : String(Number(b.bruto_upper)),
      rate_pct: String(Number(b.rate_pct)),
    })),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setRows(
      config.ter_brackets.map((b) => ({
        ter_category: b.ter_category,
        bruto_lower: String(Number(b.bruto_lower)),
        bruto_upper: b.bruto_upper === null ? '' : String(Number(b.bruto_upper)),
        rate_pct: String(Number(b.rate_pct)),
      })),
    );
  }, [config.id]);

  function updateRow(i: number, patch: Partial<(typeof rows)[number]>) {
    setRows((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  }

  function addRow() {
    setRows((prev) => [...prev, { ter_category: 'A', bruto_lower: '', bruto_upper: '', rate_pct: '' }]);
  }

  function removeRow(i: number) {
    setRows((prev) => prev.filter((_, j) => j !== i));
  }

  async function save() {
    setError('');
    setSaving(true);
    try {
      await replaceTaxBrackets(
        config.id,
        rows.map((r) => ({
          ter_category: r.ter_category,
          bruto_lower: r.bruto_lower,
          bruto_upper: r.bruto_upper === '' ? null : r.bruto_upper,
          rate_pct: r.rate_pct,
        })),
      );
      onChanged();
    } catch (err) {
      setError(apiError(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className='flex items-center justify-between'>
          <span>TER PPh 21 Bulanan (Kategori A/B/C)</span>
          {!readOnly && (
            <Button variant='outline' size='sm' onClick={addRow}>
              <Icons.add />Baris
            </Button>
          )}
        </CardTitle>
      </CardHeader>
        <CardContent className='space-y-3'>
          {error && <p className='text-destructive text-sm'>{error}</p>}
          <div className='space-y-2'>
            {rows.map((r, i) => (
              <div key={i} className='grid grid-cols-[80px_1fr_1fr_80px_36px] items-center gap-2'>
                <select
                  value={r.ter_category}
                  onChange={(e) => updateRow(i, { ter_category: e.target.value as 'A' | 'B' | 'C' })}
                  disabled={readOnly}
                  className='border-input h-8 rounded-lg border bg-transparent px-2 text-sm'
                >
                  {['A', 'B', 'C'].map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <Input
                  type='number'
                  min='0'
                  placeholder='Bruto ≥'
                  value={r.bruto_lower}
                  disabled={readOnly}
                  onChange={(e) => updateRow(i, { bruto_lower: e.target.value })}
                />
                <Input
                  type='number'
                  min='0'
                  placeholder='Bruto < (kosong = ∞)'
                  value={r.bruto_upper}
                  disabled={readOnly}
                  onChange={(e) => updateRow(i, { bruto_upper: e.target.value })}
                />
                <Input
                  type='number'
                  min='0'
                  step='0.01'
                  placeholder='%'
                  value={r.rate_pct}
                  disabled={readOnly}
                  onChange={(e) => updateRow(i, { rate_pct: e.target.value })}
                />
                {!readOnly && (
                  <Button variant='ghost' size='sm' className='text-destructive' onClick={() => removeRow(i)}>
                    <Icons.trash />
                  </Button>
                )}
              </div>
            ))}
            {rows.length === 0 && (
              <p className='text-muted-foreground py-4 text-center text-sm'>
                Belum ada bracket TER. Tambahkan baris atau jalankan seed_tax_config.
              </p>
            )}
          </div>
          {!readOnly && (
            <div className='flex justify-end'>
              <Button onClick={save} disabled={saving || rows.length === 0}>
                {saving ? 'Menyimpan...' : rows.length === 0 ? 'Reset ke Statutory' : 'Simpan Semua (ganti total)'}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
  );
}

function AnnualBracketsCard({ config, onChanged, readOnly = false }: { config: TaxConfig; onChanged: () => void; readOnly?: boolean }) {
  const [rows, setRows] = useState(
    config.annual_brackets.map((b) => ({
      layer_order: b.layer_order,
      pkp_lower: String(Number(b.pkp_lower)),
      pkp_upper: b.pkp_upper === null ? '' : String(Number(b.pkp_upper)),
      rate_pct: String(Number(b.rate_pct)),
    })),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setRows(
      config.annual_brackets.map((b) => ({
        layer_order: b.layer_order,
        pkp_lower: String(Number(b.pkp_lower)),
        pkp_upper: b.pkp_upper === null ? '' : String(Number(b.pkp_upper)),
        rate_pct: String(Number(b.rate_pct)),
      })),
    );
  }, [config.id]);

  function updateRow(i: number, patch: Partial<(typeof rows)[number]>) {
    setRows((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  }

  function addRow() {
    setRows((prev) => {
      const next = prev.length ? Math.max(...prev.map((r) => r.layer_order)) + 1 : 1;
      return next > 5 ? prev : [...prev, { layer_order: next, pkp_lower: '', pkp_upper: '', rate_pct: '' }];
    });
  }

  function removeRow(i: number) {
    setRows((prev) => prev.filter((_, j) => j !== i));
  }

  async function save() {
    setError('');
    setSaving(true);
    try {
      await replaceAnnualBrackets(
        config.id,
        rows.map((r) => ({
          layer_order: r.layer_order,
          pkp_lower: r.pkp_lower,
          pkp_upper: r.pkp_upper === '' ? null : r.pkp_upper,
          rate_pct: r.rate_pct,
        })),
      );
      onChanged();
    } catch (err) {
      setError(apiError(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className='flex items-center justify-between'>
          <span>Override Lapisan Tahunan (Pasal 17)</span>
          {!readOnly && (
            <Button variant='outline' size='sm' onClick={addRow} disabled={rows.length >= 5}>
              <Icons.add />Baris
            </Button>
          )}
        </CardTitle>
      </CardHeader>
        <CardContent className='space-y-3'>
          {error && <p className='text-destructive text-sm'>{error}</p>}
          {rows.length === 0 ? (
            <p className='text-muted-foreground py-4 text-center text-sm'>
              Menggunakan tarif statutory 5/15/25/30/35%. Tambahkan baris untuk override.
            </p>
          ) : (
            <div className='space-y-2'>
              {rows.map((r, i) => (
                <div key={i} className='grid grid-cols-[80px_1fr_1fr_80px_36px] items-center gap-2'>
                  <select
                    value={r.layer_order}
                    onChange={(e) => updateRow(i, { layer_order: Number(e.target.value) })}
                    disabled={readOnly}
                    className='border-input h-8 rounded-lg border bg-transparent px-2 text-sm'
                  >
                    {[1, 2, 3, 4, 5].map((l) => <option key={l} value={l}>Lapisan {l}</option>)}
                  </select>
                  <Input
                    type='number'
                    min='0'
                    placeholder='PKP ≥'
                    value={r.pkp_lower}
                    disabled={readOnly}
                    onChange={(e) => updateRow(i, { pkp_lower: e.target.value })}
                  />
                  <Input
                    type='number'
                    min='0'
                    placeholder='PKP < (kosong = ∞)'
                    value={r.pkp_upper}
                    disabled={readOnly}
                    onChange={(e) => updateRow(i, { pkp_upper: e.target.value })}
                  />
                  <Input
                    type='number'
                    min='0'
                    step='0.01'
                    placeholder='%'
                    value={r.rate_pct}
                    disabled={readOnly}
                    onChange={(e) => updateRow(i, { rate_pct: e.target.value })}
                  />
                  {!readOnly && (
                    <Button variant='ghost' size='sm' className='text-destructive' onClick={() => removeRow(i)}>
                      <Icons.trash />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
          {!readOnly && (
            <div className='flex justify-end'>
              <Button onClick={save} disabled={saving}>
                {saving ? 'Menyimpan...' : rows.length === 0 ? 'Reset ke Statutory' : 'Simpan Override'}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
  );
}

function TaxProfilesCard({
  profiles,
  employees,
  search,
  setSearch,
  onlyMissing,
  setOnlyMissing,
  onChanged,
  readOnly = false,
}: {
  profiles: EmployeeTaxProfile[];
  employees: Employee[];
  search: string;
  setSearch: (v: string) => void;
  onlyMissing: boolean;
  setOnlyMissing: (v: boolean) => void;
  onChanged: () => void;
  readOnly?: boolean;
}) {
  const [savingId, setSavingId] = useState<number | null>(null);
  const [error, setError] = useState('');

  const byEmployee = new Map(profiles.map((p) => [p.employee, p]));
  const active = employees.filter((e) => e.status === 'ACTIVE');
  const missingCount = active.filter((e) => !byEmployee.has(e.id)).length;
  const rows = active
    .map((e) => ({ employee: e, profile: byEmployee.get(e.id) ?? null }))
    .filter(({ employee, profile }) => {
      if (onlyMissing && profile) return false;
      if (search && !`${employee.full_name} ${employee.employee_id}`.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    })
    .sort((a, b) => a.employee.full_name.localeCompare(b.employee.full_name));

  async function save(employeeId: number, patch: { ptkp_status?: string; tax_scheme?: string }) {
    setError('');
    setSavingId(employeeId);
    try {
      const existing = byEmployee.get(employeeId);
      await upsertTaxProfile(employeeId, {
        ptkp_status: patch.ptkp_status ?? existing?.ptkp_status ?? 'TK/0',
        tax_scheme: patch.tax_scheme ?? existing?.tax_scheme ?? 'NORMAL',
      });
      onChanged();
    } catch (err) {
      setError(apiError(err));
    } finally {
      setSavingId(null);
    }
  }

  async function reset(employeeId: number) {
    const existing = byEmployee.get(employeeId);
    if (!existing) return;
    setError('');
    setSavingId(employeeId);
    try {
      await resetTaxProfile(existing.id);
      onChanged();
    } catch (err) {
      setError(apiError(err));
    } finally {
      setSavingId(null);
    }
  }

  const selectClass = 'border-input bg-background h-9 rounded-lg border px-2.5 text-sm disabled:opacity-60';

  return (
    <Card className='gap-0 overflow-hidden py-0'>
      <div className='flex flex-wrap items-start justify-between gap-3 px-6 py-5'>
        <div>
          <h3 className='text-lg font-semibold'>Profil pajak karyawan</h3>
          {missingCount > 0 ? (
            <p className='mt-0.5 text-sm text-orange-700 dark:text-orange-300'>
              {missingCount} karyawan belum diatur — memakai default TK/0 · NORMAL
            </p>
          ) : (
            <p className='text-muted-foreground mt-0.5 text-sm'>Semua karyawan aktif sudah punya profil pajak.</p>
          )}
        </div>
        <div className='flex flex-wrap items-center gap-2'>
          <div className='relative'>
            <Icons.search className='text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2' />
            <Input placeholder='Cari karyawan' value={search} onChange={(e) => setSearch(e.target.value)} className='h-10 w-56 pl-9' />
          </div>
          <label className='flex h-10 items-center gap-2 rounded-lg border px-3 text-sm'>
            <Switch checked={onlyMissing} onCheckedChange={setOnlyMissing} />
            Hanya yang belum diatur
          </label>
        </div>
      </div>
      {error && <p className='text-destructive border-t px-6 py-3 text-sm'>{error}</p>}
      <div className='overflow-x-auto border-t'>
        <table className='w-full text-sm'>
          <thead className='bg-muted/40 text-muted-foreground text-left'>
            <tr>
              <th className='px-6 py-3 font-medium'>Karyawan</th>
              <th className='px-4 py-3 font-medium'>Status PTKP</th>
              <th className='px-4 py-3 font-medium'>Kategori TER</th>
              <th className='px-4 py-3 font-medium'>Skema</th>
              <th className='px-6 py-3' />
            </tr>
          </thead>
          <tbody className='divide-y'>
            {rows.map(({ employee, profile }) => (
              <tr key={employee.id} className={profile ? '' : 'bg-orange-50/50 dark:bg-orange-500/5'}>
                <td className='px-6 py-3'>
                  <p className='font-medium'>{employee.full_name}</p>
                  <p className='text-muted-foreground font-mono text-xs'>{employee.employee_id}</p>
                </td>
                <td className='px-4 py-3'>
                  <div className='flex items-center gap-2'>
                    <select
                      value={profile?.ptkp_status ?? ''}
                      onChange={(e) => e.target.value && save(employee.id, { ptkp_status: e.target.value })}
                      disabled={savingId === employee.id || readOnly}
                      aria-label={`Status PTKP ${employee.full_name}`}
                      className={selectClass}
                    >
                      {/* No profile yet: backend default TK/0; picking any value (incl. TK/0) saves one. */}
                      {!profile && <option value=''>TK/0</option>}
                      {PTKP_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}
                    </select>
                    {!profile && (
                      <span className='rounded bg-orange-500/10 px-1.5 py-0.5 text-xs font-medium text-orange-700 dark:text-orange-300'>
                        Default
                      </span>
                    )}
                  </div>
                </td>
                <td className='px-4 py-3'>
                  <span className='bg-muted inline-flex size-7 items-center justify-center rounded-md text-xs font-semibold'>
                    {terCategoryFor(profile?.ptkp_status ?? 'TK/0')}
                  </span>
                </td>
                <td className='px-4 py-3'>
                  <select
                    value={profile?.tax_scheme ?? 'NORMAL'}
                    onChange={(e) => save(employee.id, { tax_scheme: e.target.value })}
                    disabled={savingId === employee.id || readOnly}
                    aria-label={`Skema pajak ${employee.full_name}`}
                    className={selectClass}
                  >
                    <option value='NORMAL'>NORMAL</option>
                    <option value='GROSS_UP'>GROSS_UP</option>
                  </select>
                </td>
                <td className='px-6 py-3 text-right'>
                  {!readOnly && profile && (
                    <Button
                      variant='outline'
                      size='sm'
                      onClick={() => reset(employee.id)}
                      disabled={savingId === employee.id}
                      title='Hapus profil — kembali ke default TK/0 + NORMAL'
                    >
                      Reset ke default
                    </Button>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className='text-muted-foreground py-8 text-center'>Tidak ada data.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className='text-muted-foreground border-t px-6 py-3.5 text-xs'>
        Kategori TER: A = TK/0, TK/1, K/0 · B = TK/2, TK/3, K/1, K/2 · C = K/3. Mengubah PTKP/skema langsung tersimpan sebagai profil.
      </p>
    </Card>
  );
}

function terCategoryFor(ptkp: string): 'A' | 'B' | 'C' {
  if (['TK/0', 'TK/1', 'K/0'].includes(ptkp)) return 'A';
  if (['TK/2', 'TK/3', 'K/1', 'K/2'].includes(ptkp)) return 'B';
  return 'C';
}

// ---------- Main Page ----------

export function PayrollPage({ readOnly = false }: { readOnly?: boolean }) {
  const [tab, setTab] = useState<'components' | 'structures' | 'processing' | 'tax'>('processing');
  // Employees without a salary structure in the selected period (from eligibility).
  const [notReady, setNotReady] = useState(0);
  const tabs: { value: typeof tab; label: string }[] = [
    { value: 'processing', label: 'Proses payroll' },
    { value: 'structures', label: 'Struktur gaji' },
    { value: 'components', label: 'Komponen gaji' },
    { value: 'tax', label: 'Pajak' },
  ];

  return (
    <div className='flex flex-1 flex-col gap-6 p-4 md:p-8'>
      <div>
        <h2 className='text-3xl font-bold tracking-tight'>Payroll</h2>
        <p className='text-muted-foreground mt-1'>
          {readOnly
            ? 'Mode lihat saja (read-only).'
            : 'Proses gaji bulanan, kelola struktur gaji, komponen, dan pajak.'}
        </p>
      </div>

      <div className='flex gap-1 overflow-x-auto border-b' role='tablist'>
        {tabs.map((t) => (
          <button
            key={t.value}
            type='button'
            role='tab'
            aria-selected={tab === t.value}
            onClick={() => setTab(t.value)}
            className={`-mb-px flex shrink-0 items-center gap-2 border-b-2 px-4 py-2.5 text-sm transition-colors ${
              tab === t.value
                ? 'border-foreground text-foreground font-semibold'
                : 'text-muted-foreground hover:text-foreground border-transparent'
            }`}
          >
            {t.label}
            {t.value === 'structures' && notReady > 0 && (
              <span className='rounded-full bg-orange-500/10 px-2 py-0.5 text-xs font-semibold text-orange-700 dark:text-orange-300'>
                {notReady} belum
              </span>
            )}
          </button>
        ))}
      </div>

      {tab === 'components' ? (
        <ComponentsTable readOnly={readOnly} />
      ) : tab === 'structures' ? (
        <StructuresSection readOnly={readOnly} />
      ) : tab === 'processing' ? (
        <PayrollProcessingSection
          readOnly={readOnly}
          onGoToStructures={() => setTab('structures')}
          onNotReady={setNotReady}
        />
      ) : (
        <TaxConfigSection readOnly={readOnly} />
      )}
    </div>
  );
}
