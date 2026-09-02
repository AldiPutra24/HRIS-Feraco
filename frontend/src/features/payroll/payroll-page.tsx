'use client';

import { useEffect, useState } from 'react';
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
  listComponents,
  createComponent,
  updateComponent,
  deleteComponent,
  listStructures,
  createStructure,
  historyStructures,
  listPeriods,
  createPeriod,
  deletePeriod,
  transitionPeriod,
  listPayrolls,
  addManualItem,
  removeManualItem,
} from '@/lib/payroll';
import { listEmployees, type Employee } from '@/lib/employees';

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
                onChange={(e) => setForm((f) => ({ ...f, calculation_type: e.target.value }))}
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
  const [form, setForm] = useState({
    employee: '',
    effective_from: '',
    basic_salary: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    listEmployees().then(setEmployees).catch(() => {});
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!form.employee || !form.effective_from || !form.basic_salary) {
      setError('Karyawan, Tanggal Efektif, dan Gaji Pokok wajib diisi.');
      return;
    }
    setSaving(true);
    try {
      await createStructure({
        employee: Number(form.employee),
        effective_from: form.effective_from,
        basic_salary: form.basic_salary,
        components: [],
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

  async function load() {
    setLoading(true);
    setError('');
    try {
      const [s, e] = await Promise.all([listStructures(), listEmployees()]);
      setStructures(s);
      setEmployees(e);
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
                      <Button variant='ghost' size='sm' onClick={() => showHistory(s.employee)}>
                        <Icons.clock />
                        Riwayat
                      </Button>
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

// ---------- (3) Payroll Processing ----------

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

// ---------- Main Page ----------

export function PayrollPage() {
  const [tab, setTab] = useState<'components' | 'structures' | 'processing'>('components');

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
      </div>

      {tab === 'components' ? (
        <ComponentsTable />
      ) : tab === 'structures' ? (
        <StructuresSection />
      ) : (
        <PayrollProcessingSection />
      )}
    </div>
  );
}