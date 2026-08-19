'use client';

import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  addContract,
  addHistory,
  getEmployee,
  listContracts,
  listDocuments,
  listHistory,
  updateEmployee,
  uploadDocument,
  type Contract,
  type Document,
  type Employee,
  type History
} from '@/lib/employees';

const TABS = ['Overview', 'Employment', 'Contracts', 'History', 'Documents'] as const;
type Tab = (typeof TABS)[number];

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <Label className='text-muted-foreground text-xs'>{label}</Label>
      <p className='text-sm'>{value || '-'}</p>
    </div>
  );
}

export function EmployeeDetail({ id }: { id: number }) {
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [history, setHistory] = useState<History[]>([]);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [tab, setTab] = useState<Tab>('Overview');
  const [loading, setLoading] = useState(true);
  const [contractForm, setContractForm] = useState({ contract_type: 'PKWT', start_date: '', end_date: '', notes: '' });
  const [historyForm, setHistoryForm] = useState({ date: '', history_type: 'PROMOTION', notes: '' });
  const [uploading, setUploading] = useState(false);

  const loadAll = useCallback(async () => {
    const [emp, ct, hs, docs] = await Promise.all([
      getEmployee(id),
      listContracts(id),
      listHistory(id),
      listDocuments(id)
    ]);
    setEmployee(emp);
    setContracts(ct);
    setHistory(hs);
    setDocuments(docs);
    setLoading(false);
  }, [id]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  if (loading) {
    return (
      <div className='space-y-2 p-4 md:p-6'>
        <Skeleton className='h-8 w-64' />
        <Skeleton className='h-40 w-full' />
      </div>
    );
  }

  if (!employee) return <p className='p-6'>Karyawan tidak ditemukan.</p>;

  async function submitContract(e: React.FormEvent) {
    e.preventDefault();
    await addContract(id, {
      contract_type: contractForm.contract_type,
      start_date: contractForm.start_date,
      end_date: contractForm.end_date || null,
      notes: contractForm.notes
    });
    setContractForm({ contract_type: 'PKWT', start_date: '', end_date: '', notes: '' });
    loadAll();
  }

  async function submitHistory(e: React.FormEvent) {
    e.preventDefault();
    await addHistory(id, { date: historyForm.date, history_type: historyForm.history_type, notes: historyForm.notes });
    setHistoryForm({ date: '', history_type: 'PROMOTION', notes: '' });
    loadAll();
  }

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    await uploadDocument(id, file);
    setUploading(false);
    loadAll();
  }

  async function toggleStatus(active: boolean) {
    const next = active ? 'ACTIVE' : 'INACTIVE';
    await updateEmployee(id, { employment_status: next });
    setEmployee((emp) => (emp ? { ...emp, employment_status: next } : emp));
  }

  return (
    <div className='flex flex-1 flex-col gap-4 p-4 md:p-6'>
      <div>
        <h2 className='text-2xl font-bold tracking-tight'>{employee.full_name}</h2>
        <p className='text-muted-foreground text-sm'>
          {employee.employee_id} · {employee.position_name || '-'}
        </p>
      </div>

      <div className='flex gap-2 border-b'>
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-2 text-sm font-medium ${tab === t ? 'border-b-2 border-primary text-foreground' : 'text-muted-foreground'}`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'Overview' && (
        <div className='grid grid-cols-1 gap-4 md:grid-cols-3'>
          <Card>
            <CardHeader>
              <CardTitle>Biodata</CardTitle>
            </CardHeader>
            <CardContent className='space-y-2'>
              <Field label='NIK' value={employee.nik} />
              <Field label='Tempat Lahir' value={employee.birth_place} />
              <Field label='Tanggal Lahir' value={employee.birth_date} />
              <Field label='Alamat' value={employee.address} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Kontak</CardTitle>
            </CardHeader>
            <CardContent className='space-y-2'>
              <Field label='Telepon' value={employee.phone} />
              <Field label='Email' value={employee.personal_email} />
              <Field label='Kontak Darurat' value={employee.emergency_contact_name} />
              <Field label='Telepon Darurat' value={employee.emergency_contact_phone} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Bank & Tax</CardTitle>
            </CardHeader>
            <CardContent className='space-y-2'>
              <Field label='Rekening' value={employee.bank_account_number} />
              <Field label='Nama Rekening' value={employee.bank_account_name} />
              <Field label='NPWP' value={employee.npwp} />
            </CardContent>
          </Card>
        </div>
      )}

      {tab === 'Employment' && (
        <Card>
          <CardContent className='grid grid-cols-1 gap-4 p-4 md:grid-cols-2'>
            <Field label='Departemen' value={employee.department_name} />
            <Field label='Posisi' value={employee.position_name} />
            <Field label='Manager' value={employee.manager_name} />
            <Field label='Tanggal Masuk' value={employee.join_date} />
            <Field label='Status Kepegawaian' value={
              <span className='flex items-center gap-2'>
                <Switch
                  checked={employee.employment_status === 'ACTIVE'}
                  onCheckedChange={toggleStatus}
                />
                <Badge variant={employee.employment_status === 'ACTIVE' ? 'default' : 'secondary'}>
                  {employee.employment_status}
                </Badge>
              </span>
            } />
          </CardContent>
        </Card>
      )}

      {tab === 'Contracts' && (
        <div className='space-y-4'>
          <Card>
            <CardHeader>
              <CardTitle>Tambah Kontrak</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={submitContract} className='grid grid-cols-1 gap-3 md:grid-cols-4'>
                <select
                  className='border-input h-8 rounded-lg border bg-transparent px-2.5 text-sm'
                  value={contractForm.contract_type}
                  onChange={(e) => setContractForm((f) => ({ ...f, contract_type: e.target.value }))}
                >
                  <option value='PKWT'>PKWT</option>
                  <option value='PKWTT'>PKWTT</option>
                  <option value='PROBATION'>Probation</option>
                </select>
                <Input type='date' required value={contractForm.start_date} onChange={(e) => setContractForm((f) => ({ ...f, start_date: e.target.value }))} />
                <Input type='date' value={contractForm.end_date} onChange={(e) => setContractForm((f) => ({ ...f, end_date: e.target.value }))} />
                <Button type='submit'>Tambah</Button>
                <Input className='md:col-span-4' placeholder='Catatan' value={contractForm.notes} onChange={(e) => setContractForm((f) => ({ ...f, notes: e.target.value }))} />
              </form>
            </CardContent>
          </Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tipe</TableHead>
                <TableHead>Mulai</TableHead>
                <TableHead>Selesai</TableHead>
                <TableHead>Catatan</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {contracts.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>{c.contract_type}</TableCell>
                  <TableCell>{c.start_date}</TableCell>
                  <TableCell>{c.end_date || '-'}</TableCell>
                  <TableCell>{c.notes}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {tab === 'History' && (
        <div className='space-y-4'>
          <Card>
            <CardHeader>
              <CardTitle>Tambah Riwayat</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={submitHistory} className='grid grid-cols-1 gap-3 md:grid-cols-3'>
                <Input type='date' required value={historyForm.date} onChange={(e) => setHistoryForm((f) => ({ ...f, date: e.target.value }))} />
                <select
                  className='border-input h-8 rounded-lg border bg-transparent px-2.5 text-sm'
                  value={historyForm.history_type}
                  onChange={(e) => setHistoryForm((f) => ({ ...f, history_type: e.target.value }))}
                >
                  <option value='PROMOTION'>Promotion</option>
                  <option value='TRANSFER'>Transfer</option>
                  <option value='POSITION_CHANGE'>Position Change</option>
                </select>
                <Button type='submit'>Tambah</Button>
                <Input className='md:col-span-3' placeholder='Catatan' value={historyForm.notes} onChange={(e) => setHistoryForm((f) => ({ ...f, notes: e.target.value }))} />
              </form>
            </CardContent>
          </Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tanggal</TableHead>
                <TableHead>Tipe</TableHead>
                <TableHead>Departemen Baru</TableHead>
                <TableHead>Posisi Baru</TableHead>
                <TableHead>Catatan</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {history.map((h) => (
                <TableRow key={h.id}>
                  <TableCell>{h.date}</TableCell>
                  <TableCell>{h.history_type}</TableCell>
                  <TableCell>{h.new_department_name || '-'}</TableCell>
                  <TableCell>{h.new_position_name || '-'}</TableCell>
                  <TableCell>{h.notes}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {tab === 'Documents' && (
        <div className='space-y-4'>
          <label className='inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-sm font-medium hover:bg-muted'>
            {uploading ? 'Mengunggah...' : 'Unggah Dokumen'}
            <input type='file' className='hidden' onChange={onUpload} disabled={uploading} />
          </label>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nama</TableHead>
                <TableHead>Versi</TableHead>
                <TableHead>Ukuran</TableHead>
                <TableHead>Tanggal</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {documents.map((d) => (
                <TableRow key={d.id}>
                  <TableCell>{d.name}</TableCell>
                  <TableCell>v{d.version}</TableCell>
                  <TableCell>{(d.size / 1024).toFixed(1)} KB</TableCell>
                  <TableCell>{new Date(d.created_at).toLocaleDateString()}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
