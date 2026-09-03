'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Icons } from '@/components/icons';
import { SoftHardDeleteMenu } from '@/components/soft-hard-delete-menu';
import { useAuth } from '@/lib/auth/auth-provider';
import {
  activateContract,
  addContract,
  addHistory,
  deleteContract,
  deleteDocument,
  editContract,
  getEmployee,
  listContracts,
  listDocuments,
  listHistory,
  terminateContract,
  updateEmployee,
  uploadDocument,
  type Contract,
  type Document,
  type Employee,
  type History
} from '@/lib/employees';
import { listAuditLogs, type AuditEntry } from '@/lib/audit';

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
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [history, setHistory] = useState<History[]>([]);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [tab, setTab] = useState<Tab>('Overview');
  const [loading, setLoading] = useState(true);
  const [contractForm, setContractForm] = useState({
    contract_type: 'PKWT',
    contract_number: '',
    start_date: '',
    end_date: '',
    probation_enabled: false,
    probation_start_date: '',
    probation_end_date: '',
    notes: ''
  });
  const [editingContract, setEditingContract] = useState<Contract | null>(null);
  const [terminating, setTerminating] = useState<Contract | null>(null);
  const [termForm, setTermForm] = useState({ date: '', reason: '' });
  const [historyForm, setHistoryForm] = useState({ date: '', history_type: 'PROMOTION', notes: '' });
  const [uploading, setUploading] = useState(false);
  const [documentFile, setDocumentFile] = useState<File | null>(null);

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
    if (emp.employee_id) {
      listAuditLogs({ entity_type: 'employee', entity_id: String(id) })
        .then((d) => setAudit(d.results))
        .catch(() => setAudit([]));
    }
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

  const payload = {
    contract_type: contractForm.contract_type,
    contract_number: contractForm.contract_number || null,
    start_date: contractForm.start_date,
    end_date: contractForm.end_date || null,
    probation_enabled: contractForm.probation_enabled,
    probation_start_date: contractForm.probation_start_date || null,
    probation_end_date: contractForm.probation_end_date || null,
    notes: contractForm.notes
  };

  function resetContractForm() {
    setContractForm({
      contract_type: 'PKWT',
      contract_number: '',
      start_date: '',
      end_date: '',
      probation_enabled: false,
      probation_start_date: '',
      probation_end_date: '',
      notes: ''
    });
    setEditingContract(null);
    setDocumentFile(null);
  }

  function validateContract(activate: boolean): string | null {
    const f = contractForm;
    if (!f.start_date) return 'Tanggal mulai wajib diisi.';
    if (f.end_date && f.end_date < f.start_date) return 'Tanggal selesai tidak boleh sebelum tanggal mulai.';
    if (activate && f.contract_type !== 'PKWTT' && !f.end_date) return 'Kontrak aktif wajib memiliki tanggal selesai.';
    if (f.contract_type === 'PKWT' && (f.probation_enabled || f.probation_start_date || f.probation_end_date)) {
      return 'Probation hanya berlaku untuk kontrak PKWTT.';
    }
    if (f.probation_enabled && (!f.probation_start_date || !f.probation_end_date)) {
      return 'Tanggal probation wajib diisi bila probation diaktifkan.';
    }
    if (f.probation_start_date && f.probation_end_date) {
      if (f.probation_end_date < f.probation_start_date) return 'Tanggal akhir probation tidak boleh sebelum tanggal mulai.';
      if (f.start_date && (f.probation_start_date < f.start_date || (f.end_date && f.probation_end_date > f.end_date))) {
        return 'Periode probation harus berada dalam periode kontrak.';
      }
    }
    if (!f.probation_enabled && (f.probation_start_date || f.probation_end_date)) {
      return 'Tanggal probation tidak boleh diisi bila probation nonaktif.';
    }
    return null;
  }

  async function submitContract(e: React.FormEvent, activate = false) {
    e.preventDefault();
    const error = validateContract(activate);
    if (error) {
      toast.error(error);
      return;
    }
    try {
      let contract: Contract;
      if (editingContract) {
        contract = await editContract(id, editingContract.id, payload);
        toast.success('Kontrak diperbarui.');
      } else {
        contract = await addContract(id, { ...payload, activate });
        toast.success(activate ? 'Kontrak diaktifkan.' : 'Kontrak tersimpan.');
      }
      if (documentFile) {
        await uploadDocument(id, documentFile, contract.id);
      }
      resetContractForm();
      loadAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal menyimpan kontrak.');
    }
  }

  async function onActivate(contract: Contract) {
    try {
      await activateContract(id, contract.id);
      toast.success('Kontrak diaktifkan.');
      loadAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal mengaktifkan kontrak.');
    }
  }

  async function onEdit(contract: Contract) {
    setEditingContract(contract);
    setContractForm({
      contract_type: contract.contract_type,
      contract_number: contract.contract_number || '',
      start_date: contract.start_date,
      end_date: contract.end_date || '',
      probation_enabled: contract.probation_enabled,
      probation_start_date: contract.probation_start_date || '',
      probation_end_date: contract.probation_end_date || '',
      notes: contract.notes
    });
  }

  async function onTerminate(contract: Contract) {
    setTerminating(contract);
    setTermForm({ date: '', reason: '' });
  }

  async function confirmTerminate() {
    if (!terminating) return;
    try {
      await terminateContract(id, terminating.id, {
        termination_date: termForm.date || null,
        termination_reason: termForm.reason
      });
      toast.success('Kontrak dihentikan.');
      setTerminating(null);
      loadAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal menghentikan kontrak.');
    }
  }

  async function onDeleteContract(contractId: number, hard = false) {
    if (!window.confirm(hard ? 'Hapus permanen kontrak ini?' : 'Hapus kontrak ini?')) return;
    try {
      await deleteContract(id, contractId, hard);
      toast.success('Kontrak dihapus.');
      loadAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal menghapus kontrak.');
    }
  }

  async function onDeleteDocument(docId: number, hard = false) {
    if (!window.confirm(hard ? 'Hapus permanen dokumen ini?' : 'Hapus dokumen ini?')) return;
    try {
      await deleteDocument(id, docId, hard);
      toast.success('Dokumen dihapus.');
      loadAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal menghapus dokumen.');
    }
  }

  async function submitHistory(e: React.FormEvent) {
    e.preventDefault();
    try {
      await addHistory(id, { date: historyForm.date, history_type: historyForm.history_type, notes: historyForm.notes });
      toast.success('Riwayat ditambahkan.');
      setHistoryForm({ date: '', history_type: 'PROMOTION', notes: '' });
      loadAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal menambahkan riwayat.');
    }
  }

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      await uploadDocument(id, file);
      toast.success('Dokumen diunggah.');
      loadAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal mengunggah dokumen.');
    }
    setUploading(false);
  }

  async function toggleStatus(active: boolean) {
    const next = active ? 'ACTIVE' : 'INACTIVE';
    try {
      await updateEmployee(id, { employment_status: next });
      toast.success('Status kepegawaian diperbarui.');
      setEmployee((emp) => (emp ? { ...emp, employment_status: next } : emp));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal memperbarui status.');
    }
  }

  return (
    <div className='flex flex-1 flex-col gap-4 p-4 md:p-6'>
      <div>
        <h2 className='text-2xl font-bold tracking-tight'>{employee.full_name}</h2>
        <p className='text-muted-foreground text-sm'>
          {employee.position_name || '-'}
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
              <Field label='Jenis Kelamin' value={employee.gender_display} />
              <Field label='Agama' value={employee.religion_display} />
              <Field label='Status Pernikahan' value={employee.marital_status_display} />
              <Field label='Penempatan' value={employee.placement_display} />
              <Field label='Alamat' value={employee.address} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Kontak</CardTitle>
            </CardHeader>
            <CardContent className='space-y-2'>
              <Field label='Telepon' value={employee.phone} />
              <Field label='Email Pribadi' value={employee.personal_email} />
              <Field label='Email Kantor' value={employee.company_email} />
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
          {(() => {
            const current = contracts.find((c) => c.is_current) || contracts.find((c) => c.status === 'ACTIVE');
            return (
              <Card>
                <CardHeader>
                  <CardTitle>Current Contract</CardTitle>
                </CardHeader>
                <CardContent>
                  {current ? (
                    <div className='grid grid-cols-1 gap-4 md:grid-cols-4'>
                      <Field label='Tipe' value={current.contract_type} />
                      <Field label='No. Kontrak' value={current.contract_number} />
                      <Field label='Periode' value={`${current.start_date} — ${current.end_date || 'Berlangsung'}`} />
                      <Field label='Status' value={<Badge variant='default'>{current.status}</Badge>} />
                      {current.probation_enabled && (
                        <Field
                          label='Probation'
                          value={`${current.probation_start_date || '-'} — ${current.probation_end_date || '-'}`}
                        />
                      )}
                      {current.document && (
                        <div>
                          <Label className='text-muted-foreground text-xs'>Dokumen</Label>
                          <a href={current.document} target='_blank' rel='noreferrer' className='text-primary text-sm font-medium hover:underline'>
                            View / Download
                          </a>
                        </div>
                      )}
                    </div>
                  ) : (
                    <p className='text-muted-foreground text-sm'>Belum ada kontrak aktif.</p>
                  )}
                </CardContent>
              </Card>
            );
          })()}

          <Card>
            <CardHeader>
              <CardTitle>
                {editingContract ? 'Edit Contract' : '+ Add Contract'}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={(e) => submitContract(e, false)} className='grid grid-cols-1 gap-3 md:grid-cols-4'>
                <select
                  className='border-input h-8 rounded-lg border bg-transparent px-2.5 text-sm'
                  value={contractForm.contract_type}
                  onChange={(e) => setContractForm((f) => ({
                    ...f,
                    contract_type: e.target.value,
                    end_date: e.target.value === 'PKWTT' ? '' : f.end_date,
                    probation_enabled: e.target.value === 'PKWT' ? false : f.probation_enabled,
                    probation_start_date: e.target.value === 'PKWT' ? '' : f.probation_start_date,
                    probation_end_date: e.target.value === 'PKWT' ? '' : f.probation_end_date
                  }))}
                >
                  <option value='PKWT'>PKWT</option>
                  <option value='PKWTT'>PKWTT</option>
                </select>
                <Input
                  placeholder='No. Kontrak'
                  value={contractForm.contract_number}
                  onChange={(e) => setContractForm((f) => ({ ...f, contract_number: e.target.value }))}
                />
                <Input type='date' required value={contractForm.start_date} onChange={(e) => setContractForm((f) => ({ ...f, start_date: e.target.value }))} />
                {contractForm.contract_type === 'PKWT' && (
                  <Input type='date' value={contractForm.end_date} onChange={(e) => setContractForm((f) => ({ ...f, end_date: e.target.value }))} />
                )}
                {contractForm.contract_type === 'PKWTT' && (
                  <>
                    <label className='flex items-center gap-2 text-sm'>
                      <input
                        type='checkbox'
                        checked={contractForm.probation_enabled}
                        onChange={(e) => setContractForm((f) => ({ ...f, probation_enabled: e.target.checked }))}
                      />
                      Probation
                    </label>
                    {contractForm.probation_enabled && (
                      <>
                        <Input
                          type='date'
                          value={contractForm.probation_start_date}
                          onChange={(e) => setContractForm((f) => ({ ...f, probation_start_date: e.target.value }))}
                        />
                        <Input
                          type='date'
                          value={contractForm.probation_end_date}
                          onChange={(e) => setContractForm((f) => ({ ...f, probation_end_date: e.target.value }))}
                        />
                      </>
                    )}
                  </>
                )}
                <Input className='md:col-span-4' placeholder='Catatan' value={contractForm.notes} onChange={(e) => setContractForm((f) => ({ ...f, notes: e.target.value }))} />
                <div className='md:col-span-4'>
                  <Label className='text-xs'>Dokumen Kontrak</Label>
                  <input
                    type='file'
                    className='mt-1 block w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-primary-foreground hover:file:bg-primary/80'
                    onChange={(e) => setDocumentFile(e.target.files?.[0] || null)}
                  />
                </div>
                <div className='flex items-center gap-2 md:col-span-4'>
                  <Button type='submit'>
                    {editingContract ? 'Simpan' : 'Simpan Draft'}
                  </Button>
                  {!editingContract && (
                    <Button type='button' variant='outline' onClick={(e) => submitContract(e, true)}>
                      Activate Contract
                    </Button>
                  )}
                  {editingContract && (
                    <Button variant='ghost' type='button' onClick={resetContractForm}>
                      Batal
                    </Button>
                  )}
                </div>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Contract History</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tipe</TableHead>
                    <TableHead>No. Kontrak</TableHead>
                    <TableHead>Periode</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Probation</TableHead>
                    <TableHead>Dokumen</TableHead>
                    <TableHead className='text-right'>Aksi</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {contracts.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell>{c.contract_type}</TableCell>
                      <TableCell>{c.contract_number || '-'}</TableCell>
                      <TableCell>{c.start_date} — {c.end_date || '-'}</TableCell>
                      <TableCell>
                        <Badge variant={c.status === 'ACTIVE' ? 'default' : 'secondary'}>{c.status}</Badge>
                        {c.is_current && <span className='ml-2 text-xs text-muted-foreground'>Current</span>}
                      </TableCell>
                      <TableCell>
                        {c.probation_enabled
                          ? `${c.probation_start_date || '-'} — ${c.probation_end_date || '-'}`
                          : '-'}
                      </TableCell>
                      <TableCell>
                        {c.document ? (
                          <a href={c.document} target='_blank' rel='noreferrer' className='text-primary text-sm font-medium hover:underline'>
                            View
                          </a>
                        ) : (
                          '-'
                        )}
                      </TableCell>
                      <TableCell className='text-right'>
                        <div className='flex items-center justify-end gap-2'>
                          {c.status === 'DRAFT' && (
                            <>
                              <Button variant='outline' size='sm' onClick={() => onEdit(c)}>
                                Edit
                              </Button>
                              <Button variant='outline' size='sm' onClick={() => onActivate(c)}>
                                Activate
                              </Button>
                              {isAdmin && (
                                <SoftHardDeleteMenu
                                  onSoft={() => onDeleteContract(c.id)}
                                  onHard={() => onDeleteContract(c.id, true)}
                                />
                              )}
                            </>
                          )}
                          {c.status === 'ACTIVE' && (
                            <>
                              <Button variant='outline' size='sm' onClick={() => onEdit(c)}>
                                Edit
                              </Button>
                              <Button variant='ghost' size='sm' onClick={() => onTerminate(c)}>
                                Terminate
                              </Button>
                              {isAdmin && (
                                <SoftHardDeleteMenu
                                  onSoft={() => onDeleteContract(c.id)}
                                  onHard={() => onDeleteContract(c.id, true)}
                                />
                              )}
                            </>
                          )}
                          {(c.status === 'EXPIRED' || c.status === 'RENEWED' || c.status === 'TERMINATED') && isAdmin && (
                            <SoftHardDeleteMenu
                              onSoft={() => onDeleteContract(c.id)}
                              onHard={() => onDeleteContract(c.id, true)}
                            />
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {terminating && (
                <div className='mt-4 rounded-lg border p-3'>
                  <p className='mb-2 text-sm font-medium'>
                    Terminate {terminating.contract_number || terminating.contract_type}
                  </p>
                  <div className='flex flex-wrap items-end gap-2'>
                    <div className='flex flex-col gap-1'>
                      <Label className='text-xs'>Tanggal terminasi (opsional)</Label>
                      <Input
                        type='date'
                        value={termForm.date}
                        onChange={(e) => setTermForm((f) => ({ ...f, date: e.target.value }))}
                      />
                    </div>
                    <div className='flex flex-1 flex-col gap-1'>
                      <Label className='text-xs'>Alasan (opsional)</Label>
                      <Input
                        placeholder='Alasan terminasi'
                        value={termForm.reason}
                        onChange={(e) => setTermForm((f) => ({ ...f, reason: e.target.value }))}
                      />
                    </div>
                    <Button variant='destructive' size='sm' onClick={confirmTerminate}>
                      Konfirmasi
                    </Button>
                    <Button variant='ghost' size='sm' onClick={() => setTerminating(null)}>
                      Batal
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
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

          <Card>
            <CardHeader>
              <CardTitle>Audit Trail</CardTitle>
            </CardHeader>
            <CardContent>
              {audit.length === 0 ? (
                <p className='text-muted-foreground text-sm'>Belum ada aktivitas audit terkait karyawan ini.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Time</TableHead>
                      <TableHead>Actor</TableHead>
                      <TableHead>Action</TableHead>
                      <TableHead>Detail</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {audit.map((a) => (
                      <TableRow key={a.id}>
                        <TableCell className='whitespace-nowrap'>{new Date(a.timestamp).toLocaleString()}</TableCell>
                        <TableCell>{a.actor || '-'}</TableCell>
                        <TableCell>
                          <Badge variant='outline'>{a.action}</Badge>
                        </TableCell>
                        <TableCell className='max-w-72 truncate'>{a.description || '-'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
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
                <TableHead>Sumber</TableHead>
                <TableHead>Ukuran</TableHead>
                <TableHead>Tanggal</TableHead>
                <TableHead className='text-right'>Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {documents.map((d) => (
                <TableRow key={d.id}>
                  <TableCell>{d.name}</TableCell>
                  <TableCell>{d.contract ? 'Contract' : 'Manual'}</TableCell>
                  <TableCell>{(d.size / 1024).toFixed(1)} KB</TableCell>
                  <TableCell>{new Date(d.created_at).toLocaleDateString()}</TableCell>
                  <TableCell className='text-right'>
                    <div className='flex items-center justify-end gap-2'>
                      {d.url && (
                        <a href={d.url} target='_blank' rel='noreferrer' className='text-primary text-sm font-medium hover:underline'>
                          View
                        </a>
                      )}
                      {isAdmin && (
                        <SoftHardDeleteMenu
                          onSoft={() => onDeleteDocument(d.id)}
                          onHard={() => onDeleteDocument(d.id, true)}
                        />
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
