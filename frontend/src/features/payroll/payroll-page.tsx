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
  listPayrolls,
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

// ---------- (1) Payment Type CRUD ----------

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
        <CardTitle>{editing ? 'Edit Payment Type' : 'Tambah Payment Type'}</CardTitle>
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
              <Label>Urutan</Label>
              <Input
                type='number'
                value={form.sort_order}
                onChange={(e) => setForm((f) => ({ ...f, sort_order: Number(e.target.value) }))}
              />
            </div>
            <div className='space-y-1.5'>
              <Label>Deskripsi</Label>
              <Input
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              />
            </div>
            <div className='flex items-center gap-2 pt-5'>
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

function ComponentsTable() {
  const [components, setComponents] = useState<PayrollComponent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState('');
  const [editing, setEditing] = useState<PayrollComponent | null>(null);
  const [showForm, setShowForm] = useState(false);

  async function load() {
    setLoading(true);
    setError('');
    try {
      setComponents(await listComponents());
    } catch (err) {
      setError(apiError(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const filtered = components.filter((c) => {
    if (catFilter && c.category !== catFilter) return false;
    if (search && !`${c.name} ${c.code}`.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

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

  const catLabel = (v: string) => CATEGORY.find((c) => c.value === v)?.label ?? v;

  return (
    <div className='flex flex-col gap-4'>
      <div className='flex items-center justify-between'>
        <h3 className='text-lg font-semibold tracking-tight'>Payment Types</h3>
        <Button onClick={openAdd}><Icons.add />Tambah</Button>
      </div>

      {showForm && (
        <ComponentForm editing={editing} onClose={closeForm} onSaved={() => { closeForm(); load(); }} />
      )}

      <div className='flex flex-wrap gap-2'>
        <div className='relative w-64'>
          <Icons.search className='text-muted-foreground absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2' />
          <Input
            placeholder='Cari nama / kode'
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className='pl-8'
          />
        </div>
        <select
          value={catFilter}
          onChange={(e) => setCatFilter(e.target.value)}
          className='border-input h-8 rounded-lg border bg-transparent px-2.5 text-sm'
        >
          <option value=''>Semua Kategori</option>
          {CATEGORY.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </div>

      {error && <p className='text-destructive text-sm'>{error}</p>}

      <Card>
        <CardContent className='p-0'>
          {loading ? (
            <div className='space-y-2 p-4'>
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className='h-8 w-full' />
              ))}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Kode</TableHead>
                  <TableHead>Nama</TableHead>
                  <TableHead>Kategori</TableHead>
                  <TableHead>Tipe</TableHead>
                  <TableHead>Default</TableHead>
                  <TableHead>Aktif</TableHead>
                  <TableHead className='text-right'>Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className='font-mono text-xs font-medium'>{c.code}</TableCell>
                    <TableCell>{c.name}</TableCell>
                    <TableCell>
                      <Badge variant='outline'>{catLabel(c.category)}</Badge>
                    </TableCell>
                    <TableCell className='text-xs'>{CALC.find((x) => x.value === c.calculation_type)?.label ?? c.calculation_type}</TableCell>
                    <TableCell>{c.default_amount ? Number(c.default_amount).toLocaleString('id') : '-'}</TableCell>
                    <TableCell>
                      <Badge variant={c.is_active ? 'default' : 'secondary'}>{c.is_active ? 'YA' : 'TIDAK'}</Badge>
                    </TableCell>
                    <TableCell className='text-right'>
                      <div className='flex items-center justify-end gap-2'>
                        <Button variant='ghost' size='sm' onClick={() => openEdit(c)}><Icons.edit />Edit</Button>
                        <Button variant='ghost' size='sm' onClick={() => handleDelete(c)}><Icons.trash />Hapus</Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className='text-muted-foreground py-8 text-center'>
                      Tidak ada data.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ---------- (2) Salary Structure ----------

function StructureForm({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [components, setComponents] = useState<PayrollComponent[]>([]);
  const [form, setForm] = useState({
    employee: '',
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
      setError('Pilih Payment Type untuk setiap baris komponen.');
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
        <CardTitle>Tambah Struktur Gaji</CardTitle>
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
              <Label>Komponen Gaji (Payment Type)</Label>
              <Button type='button' variant='outline' size='sm' onClick={addRow}>
                <Icons.plusCircle />Tambah Payment Type
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
                  <option value=''>Pilih Payment Type</option>
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

function StructuresSection() {
  const [structures, setStructures] = useState<SalaryStructure[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [empFilter, setEmpFilter] = useState('');
  const [showForm, setShowForm] = useState(false);
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

  const filtered = structures.filter((s) => {
    if (empFilter && s.employee !== Number(empFilter)) return false;
    return true;
  });

  function closeForm() { setShowForm(false); }

  async function showHistory(empId: number) {
    try {
      const rows = await historyStructures(empId);
      const emp = employees.find((e) => e.id === empId);
      setHistory({ empId, empName: emp?.full_name ?? `#${empId}`, rows });
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
    } catch (err) {
      setError(apiError(err));
    }
  }

  async function handleDelete(s: SalaryStructure) {
    if (!window.confirm(`Hapus permanen struktur gaji ${s.employee_name} (${s.effective_from})? Tindakan ini tidak dapat dibatalkan.`)) return;
    try {
      await deleteStructure(s.id);
      await load();
    } catch (err) {
      setError(apiError(err));
    }
  }

  return (
    <div className='flex flex-col gap-4'>
      <div className='flex items-center justify-between'>
        <h3 className='text-lg font-semibold tracking-tight'>Struktur Gaji Karyawan</h3>
        <Button onClick={() => setShowForm(true)}><Icons.add />Tambah</Button>
      </div>

      {showForm && <StructureForm onClose={closeForm} onSaved={() => { closeForm(); load(); }} />}

      <div className='flex flex-wrap gap-2'>
        <select
          value={empFilter}
          onChange={(e) => setEmpFilter(e.target.value)}
          className='border-input h-8 rounded-lg border bg-transparent px-2.5 text-sm'
        >
          <option value=''>Semua Karyawan</option>
          {employees.map((e) => (
            <option key={e.id} value={e.id}>
              {e.employee_id} - {e.full_name}
            </option>
          ))}
        </select>
      </div>

      {error && <p className='text-destructive text-sm'>{error}</p>}

      {history && (
        <Card>
          <CardHeader>
            <CardTitle className='flex items-center justify-between'>
              <span>Riwayat Gaji: {history.empName}</span>
              <Button variant='ghost' size='sm' onClick={() => setHistory(null)}>
                Tutup
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent className='p-0'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Berlaku Dari</TableHead>
                  <TableHead>Berlaku Sampai</TableHead>
                  <TableHead>Gaji Pokok</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>{r.effective_from}</TableCell>
                    <TableCell>{r.effective_to ?? 'Sekarang'}</TableCell>
                    <TableCell className='text-right font-medium'>
                      Rp {Number(r.basic_salary).toLocaleString('id')}
                    </TableCell>
                    <TableCell>
                      <Badge variant={r.is_active ? 'default' : 'secondary'}>
                        {r.is_active ? 'Aktif' : 'Nonaktif'}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
                {history.rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className='text-muted-foreground py-8 text-center'>
                      Belum ada riwayat.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className='p-0'>
          {loading ? (
            <div className='space-y-2 p-4'>
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className='h-8 w-full' />
              ))}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Karyawan</TableHead>
                  <TableHead>Berlaku Dari</TableHead>
                  <TableHead>Berlaku Sampai</TableHead>
                  <TableHead>Gaji Pokok</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className='text-right'>Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className='font-medium'>{s.employee_name}</TableCell>
                    <TableCell>{s.effective_from}</TableCell>
                    <TableCell>{s.effective_to ?? 'Sekarang'}</TableCell>
                    <TableCell className='text-right font-medium'>
                      Rp {Number(s.basic_salary).toLocaleString('id')}
                    </TableCell>
                    <TableCell>
                      <Badge variant={s.is_active ? 'default' : 'secondary'}>
                        {s.is_active ? 'Aktif' : 'Nonaktif'}
                      </Badge>
                    </TableCell>
                    <TableCell className='text-right'>
                      <div className='flex justify-end gap-1'>
                        <Button variant='ghost' size='sm' onClick={() => showHistory(s.employee)}>
                          <Icons.clock />
                          Riwayat
                        </Button>
                        {s.is_active && !s.effective_to && (
                          <Button variant='ghost' size='sm' onClick={() => handleDeactivate(s)}>
                            <Icons.close />
                            Nonaktifkan
                          </Button>
                        )}
                        {isAdmin && (
                          <Button variant='ghost' size='sm' className='text-destructive' onClick={() => handleDelete(s)}>
                            <Icons.trash />
                            Hapus
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className='text-muted-foreground py-8 text-center'>
                      Tidak ada data.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ---------- (3) Payroll Review ----------

const fmtRp = (n: number) => `Rp ${Number(n || 0).toLocaleString('id')}`;

function ReviewSection({ period }: { period: PayrollPeriod }) {
  const [data, setData] = useState<ReviewData | null>(null);
  const [eligibility, setEligibility] = useState<EligibilityData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<number | null>(null);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      getPeriodReview(period.id),
      getPeriodEligibility(period.id).catch(() => null),
    ])
      .then(([review, elig]) => {
        setData(review);
        setEligibility(elig);
      })
      .catch((err) => setError(apiError(err)))
      .finally(() => setLoading(false));
  }, [period.id]);

  if (loading) {
    return (
      <div className='space-y-2'>
        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className='h-16 w-full' />)}
      </div>
    );
  }
  if (error) return <p className='text-destructive text-sm'>{error}</p>;
  if (!data) return null;

  const s = data.summary;
  const stats = [
    { label: 'Jumlah Karyawan', value: String(s.employee_count) },
    { label: 'Total Gross', value: fmtRp(s.total_gross) },
    { label: 'Total PPh21', value: fmtRp(s.total_pph21) },
    { label: 'Total Potongan', value: fmtRp(s.total_deduction) },
    { label: 'Total THP', value: fmtRp(s.total_thp) },
    { label: 'Total Transfer', value: fmtRp(s.total_transfer) },
  ];

  return (
    <div className='flex flex-col gap-4'>
      <div className='grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6'>
        {stats.map((st) => (
          <Card key={st.label}>
            <CardContent className='p-4'>
              <p className='text-muted-foreground text-xs'>{st.label}</p>
              <p className='mt-1 truncate text-sm font-semibold tracking-tight' title={st.value}>
                {st.value}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      {eligibility && eligibility.not_ready_count > 0 && (
        <div className='rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm'>
          <p className='font-medium text-amber-900'>
            {eligibility.not_ready_count} karyawan belum memiliki struktur gaji berlaku — tidak diikutkan payroll periode ini.
          </p>
          <p className='mt-1 text-amber-800'>
            {eligibility.not_ready.map((e) => `${e.full_name} (${e.employee_id})`).join(', ')}
          </p>
        </div>
      )}

      <Card>
        <CardContent className='p-0'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Karyawan</TableHead>
                <TableHead className='text-right'>Gross</TableHead>
                <TableHead className='text-right'>PPh21</TableHead>
                <TableHead className='text-right'>Potongan</TableHead>
                <TableHead className='text-right'>THP</TableHead>
                <TableHead className='text-right'>Transfer</TableHead>
                <TableHead className='text-right'>Detail</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.employees.map((row) => (
                <Fragment key={row.payroll_id}>
                  <TableRow>
                    <TableCell className='font-medium'>
                      {row.employee_name}
                      {row.is_dtp && (
                        <Badge variant='outline' className='ml-2'>DTP</Badge>
                      )}
                    </TableCell>
                    <TableCell className='text-right'>{fmtRp(row.gross_salary)}</TableCell>
                    <TableCell className='text-right'>{fmtRp(row.pph21)}</TableCell>
                    <TableCell className='text-right'>{fmtRp(row.total_deduction)}</TableCell>
                    <TableCell className='text-right font-medium text-green-600'>
                      {fmtRp(row.net_salary)}
                    </TableCell>
                    <TableCell className='text-right font-medium'>
                      {fmtRp(row.transfer_amount)}
                    </TableCell>
                    <TableCell className='text-right'>
                      <Button
                        variant='ghost'
                        size='sm'
                        onClick={() => setExpanded((e) => (e === row.payroll_id ? null : row.payroll_id))}
                      >
                        <Icons.chevronDown />
                        Detail
                      </Button>
                    </TableCell>
                  </TableRow>
                  {expanded === row.payroll_id && (
                    <TableRow key={`${row.payroll_id}-items`}>
                      <TableCell colSpan={7} className='bg-muted/40 p-0'>
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Komponen</TableHead>
                              <TableHead>Kategori</TableHead>
                              <TableHead>Sumber</TableHead>
                              <TableHead className='text-right'>Jumlah</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {row.items.map((it) => (
                              <TableRow key={it.id}>
                                <TableCell>
                                  {it.component_name}
                                  {it.description && (
                                    <span className='text-muted-foreground block text-xs'>
                                      {it.description}
                                    </span>
                                  )}
                                </TableCell>
                                <TableCell>
                                  <Badge variant='outline'>
                                    {it.category === 'DEDUCTION'
                                      ? 'Potongan'
                                      : it.category === 'EARNING_FIXED'
                                        ? 'Tetap'
                                        : 'Variabel'}
                                  </Badge>
                                </TableCell>
                                <TableCell className='text-xs'>
                                  {it.source === 'SYSTEM' ? 'Sistem' : 'Manual'}
                                </TableCell>
                                <TableCell className='text-right'>
                                  {fmtRp(Number(it.amount))}
                                </TableCell>
                              </TableRow>
                            ))}
                            {row.items.length === 0 && (
                              <TableRow>
                                <TableCell colSpan={4} className='text-muted-foreground py-4 text-center'>
                                  Tidak ada item.
                                </TableCell>
                              </TableRow>
                            )}
                          </TableBody>
                        </Table>
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              ))}
              {data.employees.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className='text-muted-foreground py-8 text-center'>
                    Belum ada data payroll. Hitung periode terlebih dahulu.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

// ---------- (4) Payroll Processing ----------

const MONTHS = [
  { value: 1, label: 'Januari' }, { value: 2, label: 'Februari' }, { value: 3, label: 'Maret' },
  { value: 4, label: 'April' }, { value: 5, label: 'Mei' }, { value: 6, label: 'Juni' },
  { value: 7, label: 'Juli' }, { value: 8, label: 'Agustus' }, { value: 9, label: 'September' },
  { value: 10, label: 'Oktober' }, { value: 11, label: 'November' }, { value: 12, label: 'Desember' },
];

const badgeColor = (s: string) => s === 'DRAFT' ? 'secondary' as const : 'default' as const;

function PeriodForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const year = new Date().getFullYear();
  const [form, setForm] = useState({ period_month: 1, period_year: year, period_start: '', period_end: '', notes: '' });
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

function PayrollEmployeeTable({ period }: { period: PayrollPeriod }) {
  const [payrolls, setPayrolls] = useState<Payroll[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [compItems, setCompItems] = useState<PayrollComponent[]>([]);

  async function load() {
    setLoading(true); setError('');
    try {
      const [p, c] = await Promise.all([listPayrolls(period.id), listComponents()]);
      setPayrolls(p);
      setCompItems(c);
    } catch (err) { setError(apiError(err)); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, [period.id]);

  async function handleAddManual(payrollId: number, code: string, amount: string) {
    try {
      const updated = await addManualItem(payrollId, code, amount);
      setPayrolls((prev) => prev.map((pr) => pr.id === payrollId ? updated : pr));
    } catch (err) { setError(apiError(err)); }
  }

  async function handleRemoveManual(payrollId: number, code: string) {
    try {
      const updated = await removeManualItem(payrollId, code);
      setPayrolls((prev) => prev.map((pr) => pr.id === payrollId ? updated : pr));
    } catch (err) { setError(apiError(err)); }
  }

  return (
    <div className='flex flex-col gap-3'>
      <div className='flex items-center justify-between'>
        <h4 className='text-base font-semibold tracking-tight'>
          Periode {MONTHS.find((m) => m.value === period.period_month)?.label} {period.period_year}
          <Badge variant={badgeColor(period.status)} className='ml-2'>{period.status_display}</Badge>
        </h4>
        <p className='text-muted-foreground text-xs'>{period.period_start} s/d {period.period_end}</p>
      </div>
      {error && <p className='text-destructive text-sm'>{error}</p>}
      <Card>
        <CardContent className='p-0'>
          {loading ? (
            <div className='space-y-2 p-4'>
              {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className='h-8 w-full' />)}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Karyawan</TableHead>
                  <TableHead className='text-right'>Gaji Pokok</TableHead>
                  <TableHead className='text-right'>Tunj. Tetap</TableHead>
                  <TableHead className='text-right'>Tunj. Variabel</TableHead>
                  <TableHead className='text-right'>Potongan</TableHead>
                  <TableHead className='text-right'>Reimburs</TableHead>
                  <TableHead className='text-right'>Gross</TableHead>
                  <TableHead className='text-right'>Net</TableHead>
                  <TableHead className='text-right'>Item Manual</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {payrolls.map((pr) => (
                  <PayrollRow
                    key={pr.id}
                    payroll={pr}
                    components={compItems}
                    periodStatus={period.status}
                    onAddManual={handleAddManual}
                    onRemoveManual={handleRemoveManual}
                  />
                ))}
                {payrolls.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={9} className='text-muted-foreground py-8 text-center'>
                      Belum ada data payroll.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function PayrollRow({
  payroll, components, periodStatus, onAddManual, onRemoveManual,
}: {
  payroll: Payroll;
  components: PayrollComponent[];
  periodStatus: string;
  onAddManual: (id: number, code: string, amount: string) => void;
  onRemoveManual: (id: number, code: string) => void;
}) {
  const [editingCode, setEditingCode] = useState('');
  const [amountInput, setAmountInput] = useState('');

  const variableComps = components.filter((c) => c.category === 'EARNING_VARIABLE');
  const deductionComps = components.filter((c) => c.category === 'DEDUCTION');
  const manualItems = payroll.items.filter((i) => i.source === 'MANUAL');

  function addManual(code: string) {
    if (!amountInput || Number(amountInput) <= 0) return;
    onAddManual(payroll.id, code, amountInput);
    setAmountInput('');
    setEditingCode('');
  }

  function removeManual(code: string) {
    if (window.confirm(`Hapus item manual ${code}?`)) {
      onRemoveManual(payroll.id, code);
    }
  }

  const isLocked = periodStatus === 'LOCKED';

  return (
    <TableRow>
      <TableCell className='font-medium'>{payroll.employee_name}</TableCell>
      <TableCell className='text-right'>{Number(payroll.basic_salary).toLocaleString('id')}</TableCell>
      <TableCell className='text-right'>{Number(payroll.total_fixed_earning).toLocaleString('id')}</TableCell>
      <TableCell className='text-right'>{Number(payroll.total_variable_earning).toLocaleString('id')}</TableCell>
      <TableCell className='text-right'>{Number(payroll.total_deduction).toLocaleString('id')}</TableCell>
      <TableCell className='text-right'>{Number(payroll.reimbursement_total).toLocaleString('id')}</TableCell>
      <TableCell className='text-right font-medium'>{Number(payroll.gross_salary).toLocaleString('id')}</TableCell>
      <TableCell className='text-right font-medium text-green-600'>{Number(payroll.net_salary).toLocaleString('id')}</TableCell>
      <TableCell className='text-right'>
        <div className='flex flex-col gap-1'>
          {manualItems.map((item) => (
            <div key={item.id} className='flex items-center justify-end gap-1 text-xs'>
              <span>{item.component_code}: {Number(item.amount).toLocaleString('id')}</span>
              {!isLocked && (
                <button onClick={() => removeManual(item.component_code)} className='text-destructive hover:underline'>
                  <Icons.close className='h-3 w-3' />
                </button>
              )}
            </div>
          ))}
          {!isLocked && (
            <div className='flex items-center gap-1'>
              <select
                value={editingCode}
                onChange={(e) => { setEditingCode(e.target.value); setAmountInput(''); }}
                className='border-input h-6 w-24 rounded border bg-transparent px-1 text-[10px]'
              >
                <option value=''>+ Manual</option>
                {[...variableComps, ...deductionComps].map((c) => (
                  <option key={c.id} value={c.code}>{c.code}</option>
                ))}
              </select>
              {editingCode && (
                <>
                  <Input
                    type='number' step='0.01' value={amountInput}
                    onChange={(e) => setAmountInput(e.target.value)}
                    className='h-6 w-20 text-[10px]' placeholder='Jumlah'
                  />
                  <button onClick={() => addManual(editingCode)} className='text-primary text-[10px] hover:underline'>
                    OK
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}

function PayrollProcessingSection() {
  const [periods, setPeriods] = useState<PayrollPeriod[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [selectedPeriod, setSelectedPeriod] = useState<PayrollPeriod | null>(null);
  const [transitionError, setTransitionError] = useState('');

  async function load() {
    setLoading(true); setError('');
    try {
      setPeriods(await listPeriods());
    } catch (err) { setError(apiError(err)); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  async function handleDelete(p: PayrollPeriod) {
    if (!window.confirm(`Hapus periode ${p.status_display}? Data payroll akan ikut terhapus.`)) return;
    try {
      await deletePeriod(p.id);
      load();
      if (selectedPeriod?.id === p.id) setSelectedPeriod(null);
    } catch (err) { setTransitionError(apiError(err)); }
  }

  async function handleTransition(p: PayrollPeriod, action: string) {
    setTransitionError('');
    try {
      const updated = await transitionPeriod(p.id, action);
      setPeriods((prev) => prev.map((pp) => pp.id === p.id ? updated : pp));
      if (selectedPeriod?.id === p.id) setSelectedPeriod(updated);
    } catch (err) { setTransitionError(apiError(err)); }
  }

  const isLocked = (p: PayrollPeriod) => p.status === 'LOCKED';
  const isPaidUp = (p: PayrollPeriod) => p.status === 'PAID' || p.status === 'LOCKED';
  const nextAction = (p: PayrollPeriod) => {
    const steps: Record<string, string> = {
      DRAFT: 'calculate',
      CALCULATED: 'review',
      REVIEW: 'approve',
      APPROVED: 'mark-paid',
      PAID: 'lock',
    };
    return steps[p.status];
  };

  const actionLabel = (a: string) =>
    a === 'calculate' ? 'Hitung' : a === 'review' ? 'Review' : a === 'approve' ? 'Setuju' : a === 'mark-paid' ? 'Bayar' : 'Kunci';

  return (
    <div className='flex flex-col gap-4'>
      <div className='flex items-center justify-between'>
        <h3 className='text-lg font-semibold tracking-tight'>Payroll Processing</h3>
        <Button onClick={() => setShowForm(true)} disabled={showForm}>
          <Icons.add />Buat Periode
        </Button>
      </div>

      {showForm && (
        <PeriodForm onClose={() => setShowForm(false)} onSaved={() => { setShowForm(false); load(); }} />
      )}

      {transitionError && <p className='text-destructive text-sm'>{transitionError}</p>}

      {selectedPeriod ? (
        <>
          <div className='flex items-center gap-2'>
            <Button variant='ghost' size='sm' onClick={() => setSelectedPeriod(null)}>
              <Icons.chevronLeft />Kembali
            </Button>
          </div>
          {selectedPeriod.status !== 'DRAFT' && (
            <ReviewSection period={selectedPeriod} />
          )}
          <PayrollEmployeeTable period={selectedPeriod} />
        </>
      ) : (
        <Card>
          <CardContent className='p-0'>
            {loading ? (
              <div className='space-y-2 p-4'>
                {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className='h-8 w-full' />)}
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Periode</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Karyawan</TableHead>
                    <TableHead>Dibuat</TableHead>
                    <TableHead className='text-right'>Aksi</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {periods.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className='font-medium'>
                        <Button variant='link' className='h-auto p-0 text-sm' onClick={() => setSelectedPeriod(p)}>
                          {MONTHS.find((m) => m.value === p.period_month)?.label} {p.period_year}
                        </Button>
                      </TableCell>
                      <TableCell>
                        <Badge variant={badgeColor(p.status)}>{p.status_display}</Badge>
                      </TableCell>
                      <TableCell>{p.payroll_count}</TableCell>
                      <TableCell className='text-xs text-slate-500'>{p.created_at?.slice(0, 10)}</TableCell>
                      <TableCell className='text-right'>
                        <div className='flex items-center justify-end gap-1'>
                          {nextAction(p) && !isLocked(p) && (
                            <Button variant='ghost' size='sm' onClick={() => handleTransition(p, nextAction(p)!)}>
                              {nextAction(p) === 'calculate' ? <Icons.plusCircle /> : <Icons.check />}
                              {actionLabel(nextAction(p)!)}
                            </Button>
                          )}
                          {!isLocked(p) && (
                            <Button variant='ghost' size='sm' className='text-destructive' onClick={() => handleDelete(p)}>
                              <Icons.trash />
                            </Button>
                          )}
                          {isPaidUp(p) && (
                            <Button
                              variant='ghost'
                              size='sm'
                              onClick={() =>
                                downloadPayslip(p.id, `${p.period_year}-${String(p.period_month).padStart(2, '0')}`)
                                  .catch(() => {})
                              }
                            >
                              <Icons.download />Rekap
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                  {periods.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className='text-muted-foreground py-8 text-center'>
                        Belum ada periode. Buat periode baru untuk memulai.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ---------- (4) Tax Config (Tahap 3a/3b UI) ----------

function TaxConfigSection() {
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

  return (
    <div className='flex flex-col gap-4'>
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
          <div className='flex flex-wrap items-center gap-2'>
            <select
              value={selectedId ?? ''}
              onChange={(e) => setSelectedId(Number(e.target.value))}
              className='border-input h-8 rounded-lg border bg-transparent px-2.5 text-sm'
            >
              {configs.map((c) => (
                <option key={c.id} value={c.id}>
                  Tahun {c.year}{c.is_active ? ' (aktif)' : ''}
                </option>
              ))}
            </select>
            {selected?.is_active && (
              <Badge variant='default'>Konfigurasi Aktif</Badge>
            )}
          </div>
          {selected && <TaxConfigDetail config={selected} onChanged={load} />}
          <TaxProfilesCard
            profiles={profiles}
            employees={employees}
            search={profileSearch}
            setSearch={setProfileSearch}
            onlyMissing={onlyMissing}
            setOnlyMissing={setOnlyMissing}
            onChanged={load}
          />
        </>
      )}
    </div>
  );
}

function TaxConfigDetail({ config, onChanged }: { config: TaxConfig; onChanged: () => void }) {
  const [dtp, setDtp] = useState(String(Number(config.dtp_threshold)));
  const [layerLimits, setLayerLimits] = useState(
    (config.annual_layer_limits ?? []).map((v) => String(Number(v))),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setDtp(String(Number(config.dtp_threshold)));
    setLayerLimits((config.annual_layer_limits ?? []).map((v) => String(Number(v))));
  }, [config.id]);

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

  async function toggleActive() {
    setError('');
    try {
      await updateTaxConfig(config.id, { is_active: !config.is_active });
      onChanged();
    } catch (err) {
      setError(apiError(err));
    }
  }

  return (
    <div className='grid gap-4 lg:grid-cols-2'>
      <Card>
        <CardHeader>
          <CardTitle className='flex items-center justify-between'>
            <span>Umum — Tahun {config.year}</span>
            <div className='flex items-center gap-2'>
              <Switch checked={config.is_active} onCheckedChange={toggleActive} />
              <Label className='text-sm'>Aktif</Label>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={saveGeneral} className='space-y-4'>
            {error && <p className='text-destructive text-sm'>{error}</p>}
            <div className='space-y-1.5'>
              <Label>Ambang DTP (Rp) — THP ≤ nilai ini: PPh tidak dipotong dari transfer</Label>
              <Input
                type='number'
                min='0'
                value={dtp}
                onChange={(e) => setDtp(e.target.value)}
              />
            </div>
            <div className='flex justify-end'>
              <Button type='submit' disabled={saving}>
                {saving ? 'Menyimpan...' : 'Simpan'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Batas Lapisan Tahunan (Pasal 17)</CardTitle>
        </CardHeader>
        <CardContent className='space-y-3'>
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
                  onChange={(e) =>
                    setLayerLimits((prev) => prev.map((p, j) => (j === i ? e.target.value : p)))
                  }
                />
              </div>
            ))}
          </div>
          <div className='flex justify-end'>
            <Button onClick={saveLayers} disabled={saving}>
              {saving ? 'Menyimpan...' : 'Simpan Batas'}
            </Button>
          </div>
        </CardContent>
      </Card>

      <TerBracketsCard config={config} onChanged={onChanged} />
      <AnnualBracketsCard config={config} onChanged={onChanged} />
    </div>
  );
}

function TerBracketsCard({ config, onChanged }: { config: TaxConfig; onChanged: () => void }) {
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
          <Button variant='outline' size='sm' onClick={addRow}>
            <Icons.add />Baris
          </Button>
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
                  className='border-input h-8 rounded-lg border bg-transparent px-2 text-sm'
                >
                  {['A', 'B', 'C'].map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <Input
                  type='number'
                  min='0'
                  placeholder='Bruto ≥'
                  value={r.bruto_lower}
                  onChange={(e) => updateRow(i, { bruto_lower: e.target.value })}
                />
                <Input
                  type='number'
                  min='0'
                  placeholder='Bruto < (kosong = ∞)'
                  value={r.bruto_upper}
                  onChange={(e) => updateRow(i, { bruto_upper: e.target.value })}
                />
                <Input
                  type='number'
                  min='0'
                  step='0.01'
                  placeholder='%'
                  value={r.rate_pct}
                  onChange={(e) => updateRow(i, { rate_pct: e.target.value })}
                />
                <Button variant='ghost' size='sm' className='text-destructive' onClick={() => removeRow(i)}>
                  <Icons.trash />
                </Button>
              </div>
            ))}
            {rows.length === 0 && (
              <p className='text-muted-foreground py-4 text-center text-sm'>
                Belum ada bracket TER. Tambahkan baris atau jalankan seed_tax_config.
              </p>
            )}
          </div>
          <div className='flex justify-end'>
            <Button onClick={save} disabled={saving || rows.length === 0}>
              {saving ? 'Menyimpan...' : rows.length === 0 ? 'Reset ke Statutory' : 'Simpan Semua (ganti total)'}
            </Button>
          </div>
        </CardContent>
      </Card>
  );
}

function AnnualBracketsCard({ config, onChanged }: { config: TaxConfig; onChanged: () => void }) {
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
          <Button variant='outline' size='sm' onClick={addRow} disabled={rows.length >= 5}>
            <Icons.add />Baris
          </Button>
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
                    className='border-input h-8 rounded-lg border bg-transparent px-2 text-sm'
                  >
                    {[1, 2, 3, 4, 5].map((l) => <option key={l} value={l}>Lapisan {l}</option>)}
                  </select>
                  <Input
                    type='number'
                    min='0'
                    placeholder='PKP ≥'
                    value={r.pkp_lower}
                    onChange={(e) => updateRow(i, { pkp_lower: e.target.value })}
                  />
                  <Input
                    type='number'
                    min='0'
                    placeholder='PKP < (kosong = ∞)'
                    value={r.pkp_upper}
                    onChange={(e) => updateRow(i, { pkp_upper: e.target.value })}
                  />
                  <Input
                    type='number'
                    min='0'
                    step='0.01'
                    placeholder='%'
                    value={r.rate_pct}
                    onChange={(e) => updateRow(i, { rate_pct: e.target.value })}
                  />
                  <Button variant='ghost' size='sm' className='text-destructive' onClick={() => removeRow(i)}>
                    <Icons.trash />
                  </Button>
                </div>
              ))}
            </div>
          )}
          <div className='flex justify-end'>
            <Button onClick={save} disabled={saving}>
              {saving ? 'Menyimpan...' : rows.length === 0 ? 'Reset ke Statutory' : 'Simpan Override'}
            </Button>
          </div>
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
}: {
  profiles: EmployeeTaxProfile[];
  employees: Employee[];
  search: string;
  setSearch: (v: string) => void;
  onlyMissing: boolean;
  setOnlyMissing: (v: boolean) => void;
  onChanged: () => void;
}) {
  const [savingId, setSavingId] = useState<number | null>(null);
  const [error, setError] = useState('');

  const byEmployee = new Map(profiles.map((p) => [p.employee, p]));
  const active = employees.filter((e) => e.status === 'ACTIVE');
  const rows = active
    .map((e) => ({ employee: e, profile: byEmployee.get(e.id) ?? null }))
    .filter(({ employee, profile }) => {
      if (onlyMissing && profile) return false;
      if (search && !employee.full_name.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });

  async function save(employeeId: number, patch: { ptkp_status?: string; tax_scheme?: string }) {
    setError('');
    setSavingId(employeeId);
    try {
      const existing = byEmployee.get(employeeId);
      if (existing) {
        await upsertTaxProfile(employeeId, {
          ptkp_status: patch.ptkp_status ?? existing.ptkp_status,
          tax_scheme: patch.tax_scheme ?? existing.tax_scheme,
        });
      } else {
        await upsertTaxProfile(employeeId, {
          ptkp_status: patch.ptkp_status ?? 'TK/0',
          tax_scheme: patch.tax_scheme ?? 'NORMAL',
        });
      }
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

  return (
    <Card>
      <CardHeader>
        <CardTitle>Profil Pajak Karyawan (PTKP & Skema)</CardTitle>
      </CardHeader>
      <CardContent className='space-y-3'>
        {error && <p className='text-destructive text-sm'>{error}</p>}
        <div className='flex flex-wrap items-center gap-2'>
          <div className='relative w-64'>
            <Icons.search className='text-muted-foreground absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2' />
            <Input
              placeholder='Cari karyawan'
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className='pl-8'
            />
          </div>
          <div className='flex items-center gap-2'>
            <Switch checked={onlyMissing} onCheckedChange={setOnlyMissing} />
            <Label className='text-sm'>Hanya tanpa profil</Label>
          </div>
          <span className='text-muted-foreground ml-auto text-xs'>
            Tanpa profil: {active.filter((e) => !byEmployee.has(e.id)).length} karyawan (default TK/0, NORMAL)
          </span>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Karyawan</TableHead>
              <TableHead>PTKP</TableHead>
              <TableHead>Kategori TER</TableHead>
              <TableHead>Skema</TableHead>
              <TableHead className='text-right'>Aksi</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(({ employee, profile }) => (
              <TableRow key={employee.id}>
                <TableCell className='font-medium'>
                  {employee.full_name}
                  <span className='text-muted-foreground ml-2 text-xs'>{employee.employee_id}</span>
                </TableCell>
                <TableCell>
                  <select
                    value={profile?.ptkp_status ?? ''}
                    onChange={(e) => save(employee.id, { ptkp_status: e.target.value })}
                    disabled={savingId === employee.id}
                    className='border-input h-8 rounded-lg border bg-transparent px-2 text-sm'
                  >
                    <option value=''>TK/0 (default)</option>
                    {PTKP_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </TableCell>
                <TableCell className='text-sm'>
                  {profile ? terCategoryFor(profile.ptkp_status) : terCategoryFor('TK/0')}
                </TableCell>
                <TableCell>
                  <select
                    value={profile?.tax_scheme ?? 'NORMAL'}
                    onChange={(e) => save(employee.id, { tax_scheme: e.target.value })}
                    disabled={savingId === employee.id}
                    className='border-input h-8 rounded-lg border bg-transparent px-2 text-sm'
                  >
                    <option value='NORMAL'>NORMAL</option>
                    <option value='GROSS_UP'>GROSS_UP</option>
                  </select>
                </TableCell>
                <TableCell className='text-right'>
                  {profile && (
                    <Button
                      variant='ghost'
                      size='sm'
                      onClick={() => reset(employee.id)}
                      disabled={savingId === employee.id}
                      title='Hapus profil — kembali ke default TK/0 + NORMAL'
                    >
                      <Icons.trash className='h-4 w-4' />
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className='text-muted-foreground py-8 text-center'>
                  Tidak ada data.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function terCategoryFor(ptkp: string): 'A' | 'B' | 'C' {
  if (['TK/0', 'TK/1', 'K/0'].includes(ptkp)) return 'A';
  if (['TK/2', 'TK/3', 'K/1', 'K/2'].includes(ptkp)) return 'B';
  return 'C';
}

// ---------- Main Page ----------

export function PayrollPage() {
  const [tab, setTab] = useState<'components' | 'structures' | 'processing' | 'tax'>('components');

  return (
    <div className='flex flex-1 flex-col gap-4 p-4 md:p-6'>
      <div className='flex items-center justify-between'>
        <div>
          <h2 className='text-2xl font-bold tracking-tight'>Payroll</h2>
          <p className='text-muted-foreground text-sm'>
            Kelola payment type dan struktur gaji karyawan.
          </p>
        </div>
      </div>

      <div className='flex gap-1 border-b'>
        <button
          onClick={() => setTab('components')}
          className={`px-4 py-1.5 text-sm font-medium transition-colors ${
            tab === 'components'
              ? 'border-primary text-primary border-b-2'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          Payment Types
        </button>
        <button
          onClick={() => setTab('structures')}
          className={`px-4 py-1.5 text-sm font-medium transition-colors ${
            tab === 'structures'
              ? 'border-primary text-primary border-b-2'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          Struktur Gaji
        </button>
        <button
          onClick={() => setTab('processing')}
          className={`px-4 py-1.5 text-sm font-medium transition-colors ${
            tab === 'processing'
              ? 'border-primary text-primary border-b-2'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          Payroll Processing
        </button>
        <button
          onClick={() => setTab('tax')}
          className={`px-4 py-1.5 text-sm font-medium transition-colors ${
            tab === 'tax'
              ? 'border-primary text-primary border-b-2'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          Konfigurasi Pajak
        </button>
      </div>

      {tab === 'components' ? (
        <ComponentsTable />
      ) : tab === 'structures' ? (
        <StructuresSection />
      ) : tab === 'processing' ? (
        <PayrollProcessingSection />
      ) : (
        <TaxConfigSection />
      )}
    </div>
  );
}