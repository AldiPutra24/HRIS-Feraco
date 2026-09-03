'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { createEmployee, listDepartments, listPositions, updateEmployee, type Department, type Employee, type Position } from '@/lib/employees';

type Props = { employee?: Employee | null; onSaved: () => void; onCancel: () => void };

type FormState = {
  full_name: string;
  nik: string;
  birth_place: string;
  birth_date: string;
  address: string;
  phone: string;
  personal_email: string;
  company_email: string;
  emergency_contact_name: string;
  emergency_contact_phone: string;
  bank_account_number: string;
  bank_account_name: string;
  npwp: string;
  bpjs_kesehatan: string;
  bpjs_ketenagakerjaan: string;
  placement: string;
  religion: string;
  gender: string;
  marital_status: string;
  department: string;
  position: string;
  manager: string;
  join_date: string;
  employment_status: string;
};

type Errors = Partial<Record<keyof FormState, string>>;

const PHONE_RE = /^[0-9+\-() ]*$/;
const EMAIL_RE = /^\S+@\S+\.\S+$/;

function validate(f: FormState): Errors {
  const e: Errors = {};
  if (!f.full_name.trim()) e.full_name = 'Wajib diisi.';
  if (f.nik && !/^\d+$/.test(f.nik)) e.nik = 'Hanya angka.';
  else if (f.nik && f.nik.length !== 16) e.nik = 'NIK harus 16 digit.';
  if (f.phone && !PHONE_RE.test(f.phone)) e.phone = 'Format telepon tidak valid.';
  if (f.personal_email && !EMAIL_RE.test(f.personal_email)) e.personal_email = 'Email tidak valid.';
  if (f.company_email && !EMAIL_RE.test(f.company_email)) e.company_email = 'Email tidak valid.';
  if (!f.personal_email.trim()) e.personal_email = 'Wajib diisi.';
  if (!f.company_email.trim()) e.company_email = 'Wajib diisi.';
  if (f.emergency_contact_phone && !PHONE_RE.test(f.emergency_contact_phone))
    e.emergency_contact_phone = 'Format telepon tidak valid.';
  if (f.bank_account_number && !/^\d+$/.test(f.bank_account_number)) e.bank_account_number = 'Hanya angka.';
  if (f.npwp && !/^\d+$/.test(f.npwp)) e.npwp = 'Hanya angka.';
  if (f.bpjs_kesehatan && !/^\d+$/.test(f.bpjs_kesehatan)) e.bpjs_kesehatan = 'Hanya angka.';
  if (f.bpjs_ketenagakerjaan && !/^\d+$/.test(f.bpjs_ketenagakerjaan))
    e.bpjs_ketenagakerjaan = 'Hanya angka.';
  return e;
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div className='space-y-1.5'>
      <Label>{label}</Label>
      {children}
      {error && <p className='text-destructive text-xs'>{error}</p>}
    </div>
  );
}

const EMPTY: FormState = {
  full_name: '',
  nik: '',
  birth_place: '',
  birth_date: '',
  address: '',
  phone: '',
  company_email: '',
  personal_email: '',
  emergency_contact_name: '',
  emergency_contact_phone: '',
  bank_account_number: '',
  bank_account_name: '',
  npwp: '',
  bpjs_kesehatan: '',
  bpjs_ketenagakerjaan: '',
  placement: '',
  religion: '',
  gender: '',
  marital_status: '',
  department: '',
  position: '',
  manager: '',
  join_date: '',
  employment_status: 'ACTIVE'
};

const toDate = (v: string | null | undefined) => (v ? v.slice(0, 10) : '');
const toId = (v: number | null | undefined) => (v ? String(v) : '');

function toForm(e: Employee): FormState {
  return {
    full_name: e.full_name ?? '',
    nik: e.nik ?? '',
    birth_place: e.birth_place ?? '',
    birth_date: toDate(e.birth_date),
    address: e.address ?? '',
    phone: e.phone ?? '',
    company_email: e.company_email ?? '',
    personal_email: e.personal_email ?? '',
    emergency_contact_name: e.emergency_contact_name ?? '',
    emergency_contact_phone: e.emergency_contact_phone ?? '',
    bank_account_number: e.bank_account_number ?? '',
    bank_account_name: e.bank_account_name ?? '',
    npwp: e.npwp ?? '',
    bpjs_kesehatan: e.bpjs_kesehatan ?? '',
    bpjs_ketenagakerjaan: e.bpjs_ketenagakerjaan ?? '',
    placement: e.placement ?? '',
    religion: e.religion ?? '',
    gender: e.gender ?? '',
    marital_status: e.marital_status ?? '',
    department: toId(e.department),
    position: toId(e.position),
    manager: toId(e.manager),
    join_date: toDate(e.join_date),
    employment_status: e.employment_status ?? 'ACTIVE'
  };
}

export function EmployeeForm({ employee, onSaved, onCancel }: Props) {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [deptLoading, setDeptLoading] = useState(true);
  const [deptError, setDeptError] = useState('');
  const [posLoading, setPosLoading] = useState(false);
  const [posError, setPosError] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [form, setForm] = useState<FormState>(() => (employee ? toForm(employee) : EMPTY));

  useEffect(() => {
    listDepartments()
      .then((ds) => setDepartments(ds.filter((d) => d.is_active)))
      .catch(() => setDeptError('Gagal memuat daftar department.'))
      .finally(() => setDeptLoading(false));
  }, []);

  useEffect(() => {
    const deptId = form.department;
    if (!deptId) {
      setPositions([]);
      setPosLoading(false);
      setPosError('');
      return;
    }
    setPosLoading(true);
    setPosError('');
    listPositions(Number(deptId))
      .then((ps) => setPositions(ps.filter((p) => p.is_active)))
      .catch(() => setPosError('Gagal memuat daftar position.'))
      .finally(() => setPosLoading(false));
  }, [form.department]);

  function selectDepartment(value: string) {
    setForm((f) => ({ ...f, department: value, position: '' }));
    setErrors((prev) => ({ ...prev, department: undefined, position: undefined }));
  }

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((prev) => ({ ...prev, [key]: undefined }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    const errs = validate(form);
    setErrors(errs);
    if (Object.values(errs).some(Boolean)) return;
    setSaving(true);
    try {
      const payload = {
        full_name: form.full_name,
        nik: form.nik,
        birth_place: form.birth_place,
        birth_date: form.birth_date || null,
        address: form.address,
        phone: form.phone,
        company_email: form.company_email,
        personal_email: form.personal_email,
        emergency_contact_name: form.emergency_contact_name,
        emergency_contact_phone: form.emergency_contact_phone,
        bank_account_number: form.bank_account_number,
        bank_account_name: form.bank_account_name,
        npwp: form.npwp,
        bpjs_kesehatan: form.bpjs_kesehatan,
        bpjs_ketenagakerjaan: form.bpjs_ketenagakerjaan,
        placement: form.placement || null,
        religion: form.religion || null,
        gender: form.gender || null,
        marital_status: form.marital_status || null,
        department: form.department ? Number(form.department) : null,
        position: form.position ? Number(form.position) : null,
        manager: form.manager ? Number(form.manager) : null,
        join_date: form.join_date || null,
        employment_status: form.employment_status
      };
      if (employee) await updateEmployee(employee.id, payload);
      else await createEmployee(payload);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menyimpan.');
    } finally {
      setSaving(false);
    }
  }

  const sectionClass = 'grid grid-cols-1 gap-4 md:grid-cols-2';

  return (
    <form onSubmit={submit} className='space-y-6'>
      {error && <p className='text-destructive text-sm'>{error}</p>}

      <div className='space-y-3'>
        <h3 className='text-sm font-semibold'>Personal Information</h3>
        <div className={sectionClass}>
          <Field label='Nama Lengkap' error={errors.full_name}>
            <Input required value={form.full_name} onChange={(e) => set('full_name', e.target.value)} />
          </Field>
          <Field label='NIK' error={errors.nik}>
            <Input value={form.nik} onChange={(e) => set('nik', e.target.value)} />
          </Field>
          <Field label='Tempat Lahir'>
            <Input value={form.birth_place} onChange={(e) => set('birth_place', e.target.value)} />
          </Field>
          <Field label='Tanggal Lahir'>
            <Input type='date' value={form.birth_date} onChange={(e) => set('birth_date', e.target.value)} />
          </Field>
          <Field label='Jenis Kelamin'>
            <select className='border-input h-8 rounded-lg border bg-transparent px-2.5 text-sm' value={form.gender} onChange={(e) => set('gender', e.target.value)}>
              <option value=''>-</option>
              <option value='MALE'>Laki-laki</option>
              <option value='FEMALE'>Perempuan</option>
            </select>
          </Field>
          <Field label='Agama'>
            <select className='border-input h-8 rounded-lg border bg-transparent px-2.5 text-sm' value={form.religion} onChange={(e) => set('religion', e.target.value)}>
              <option value=''>-</option>
              <option value='ISLAM'>Islam</option>
              <option value='PROTESTAN'>Protestan</option>
              <option value='KATOLIK'>Katolik</option>
              <option value='HINDU'>Hindu</option>
              <option value='BUDDHA'>Buddha</option>
              <option value='KONGHUCU'>Konghucu</option>
            </select>
          </Field>
          <Field label='Status Pernikahan'>
            <select className='border-input h-8 rounded-lg border bg-transparent px-2.5 text-sm' value={form.marital_status} onChange={(e) => set('marital_status', e.target.value)}>
              <option value=''>-</option>
              <option value='SINGLE'>Belum Menikah</option>
              <option value='MARRIED'>Menikah</option>
              <option value='DIVORCED'>Cerai</option>
              <option value='WIDOWED'>Janda/Duda</option>
            </select>
          </Field>
          <Field label='Penempatan'>
            <select className='border-input h-8 rounded-lg border bg-transparent px-2.5 text-sm' value={form.placement} onChange={(e) => set('placement', e.target.value)}>
              <option value=''>-</option>
              <option value='JAKARTA'>Jakarta</option>
              <option value='JOGJA'>Jogja</option>
            </select>
          </Field>
          <Field label='Alamat'>
            <Input value={form.address} onChange={(e) => set('address', e.target.value)} />
          </Field>
        </div>
      </div>

      <div className='space-y-3'>
        <h3 className='text-sm font-semibold'>Contact & Emergency</h3>
        <div className={sectionClass}>
          <Field label='Telepon' error={errors.phone}>
            <Input value={form.phone} onChange={(e) => set('phone', e.target.value)} />
          </Field>
          <Field label='Email Pribadi' error={errors.personal_email}>
            <Input type='email' value={form.personal_email} onChange={(e) => set('personal_email', e.target.value)} />
          </Field>
          <Field label='Email Kantor' error={errors.company_email}>
            <Input type='email' value={form.company_email} onChange={(e) => set('company_email', e.target.value)} />
          </Field>
          <Field label='Nama Kontak Darurat'>
            <Input value={form.emergency_contact_name} onChange={(e) => set('emergency_contact_name', e.target.value)} />
          </Field>
          <Field label='Telepon Kontak Darurat' error={errors.emergency_contact_phone}>
            <Input value={form.emergency_contact_phone} onChange={(e) => set('emergency_contact_phone', e.target.value)} />
          </Field>
        </div>
      </div>

      <div className='space-y-3'>
        <h3 className='text-sm font-semibold'>Employment</h3>
        <div className={sectionClass}>
          <Field label='Departemen'>
            {deptLoading ? (
              <p className='text-muted-foreground text-xs'>Memuat department...</p>
            ) : deptError ? (
              <p className='text-destructive text-xs'>{deptError}</p>
            ) : (
              <select className='border-input h-8 rounded-lg border bg-transparent px-2.5 text-sm' value={form.department} onChange={(e) => selectDepartment(e.target.value)}>
                <option value=''>-</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label='Posisi'>
            {!form.department ? (
              <p className='text-muted-foreground text-xs'>Pilih department terlebih dahulu.</p>
            ) : posLoading ? (
              <p className='text-muted-foreground text-xs'>Memuat position...</p>
            ) : posError ? (
              <p className='text-destructive text-xs'>{posError}</p>
            ) : positions.length === 0 ? (
              <p className='text-muted-foreground text-xs'>No positions available.</p>
            ) : (
              <select className='border-input h-8 rounded-lg border bg-transparent px-2.5 text-sm' value={form.position} onChange={(e) => set('position', e.target.value)}>
                <option value=''>-</option>
                {positions.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label='Tanggal Masuk'>
            <Input type='date' value={form.join_date} onChange={(e) => set('join_date', e.target.value)} />
          </Field>
          <Field label='Status Kepegawaian'>
            <select className='border-input h-8 rounded-lg border bg-transparent px-2.5 text-sm' value={form.employment_status} onChange={(e) => set('employment_status', e.target.value)}>
              <option value='ACTIVE'>Active</option>
              <option value='INACTIVE'>Inactive</option>
            </select>
          </Field>
        </div>
      </div>

      <div className='space-y-3'>
        <h3 className='text-sm font-semibold'>Bank & Tax</h3>
        <div className={sectionClass}>
          <Field label='Nomor Rekening' error={errors.bank_account_number}>
            <Input value={form.bank_account_number} onChange={(e) => set('bank_account_number', e.target.value)} />
          </Field>
          <Field label='Nama Rekening'>
            <Input value={form.bank_account_name} onChange={(e) => set('bank_account_name', e.target.value)} />
          </Field>
          <Field label='NPWP' error={errors.npwp}>
            <Input value={form.npwp} onChange={(e) => set('npwp', e.target.value)} />
          </Field>
        </div>
      </div>

      <div className='space-y-3'>
        <h3 className='text-sm font-semibold'>BPJS</h3>
        <div className={sectionClass}>
          <Field label='BPJS Kesehatan (opsional)' error={errors.bpjs_kesehatan}>
            <Input value={form.bpjs_kesehatan} onChange={(e) => set('bpjs_kesehatan', e.target.value)} />
          </Field>
          <Field label='BPJS Ketenagakerjaan (opsional)' error={errors.bpjs_ketenagakerjaan}>
            <Input value={form.bpjs_ketenagakerjaan} onChange={(e) => set('bpjs_ketenagakerjaan', e.target.value)} />
          </Field>
        </div>
      </div>

      <div className='flex justify-end gap-2'>
        <Button type='button' variant='outline' onClick={onCancel}>
          Batal
        </Button>
        <Button type='submit' disabled={saving}>
          {saving ? 'Menyimpan...' : 'Simpan'}
        </Button>
      </div>
    </form>
  );
}
