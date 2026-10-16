'use client';

import { useState } from 'react';
import { toast } from 'react-toastify';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Icons } from '@/components/icons';
import {
  createLeaveType,
  deleteLeaveType,
  updateLeaveType,
  type LeaveType,
  type NewLeaveType
} from '@/lib/leaves';

const EMPTY: NewLeaveType = {
  name: '',
  kind: 'LEAVE',
  default_quota: 0,
  min_notice_days: 0,
  requires_attachment: false,
  is_paid: true,
  description: '',
  deducts_from: null
};

/**
 * HR: manage izin/cuti categories — add, delete (used/built-in categories are
 * deactivated instead, history kept), re-activate, and the minimum notice per
 * category ("paling lambat H-N", 0 = no minimum). Rules enforced by backend.
 */
export function LeaveCategoryManager({
  types,
  onChanged
}: {
  types: LeaveType[];
  onChanged: (next: LeaveType[]) => void;
}) {
  const [draft, setDraft] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<number | 'new' | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<NewLeaveType>(EMPTY);
  const [showInactive, setShowInactive] = useState(false);

  const sorted = [...types].sort(
    (a, b) => Number(b.is_active) - Number(a.is_active) || a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name)
  );
  const visible = showInactive ? sorted : sorted.filter((t) => t.is_active);
  const inactiveCount = types.filter((t) => !t.is_active).length;
  // Target of the "Potong kuota Cuti Tahunan" checkbox.
  const annual = types.find((t) => t.code === 'ANNUAL') ?? null;

  function replace(updated: LeaveType) {
    onChanged(types.map((t) => (t.id === updated.id ? updated : t)));
  }

  async function saveNotice(t: LeaveType) {
    const value = Number(draft[t.id] ?? t.min_notice_days);
    if (!Number.isInteger(value) || value < 0 || value > 365) {
      toast.error('Isi angka hari 0–365.');
      return;
    }
    setBusy(t.id);
    try {
      replace(await updateLeaveType(t.id, { min_notice_days: value }));
      setDraft((d) => {
        const next = { ...d };
        delete next[t.id];
        return next;
      });
      toast.success(`${t.name}: minimal pengajuan disimpan.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal menyimpan.');
    } finally {
      setBusy(null);
    }
  }

  async function remove(t: LeaveType) {
    if (!window.confirm(`Hapus kategori "${t.name}"?\nKategori yang sudah pernah dipakai akan dinonaktifkan (riwayat tetap tersimpan).`)) return;
    setBusy(t.id);
    try {
      const res = await deleteLeaveType(t.id);
      if (res.deactivated) {
        replace(res.deactivated);
        toast.info(res.detail ?? `Kategori "${t.name}" dinonaktifkan.`);
      } else {
        onChanged(types.filter((x) => x.id !== t.id));
        toast.success(`Kategori "${t.name}" dihapus.`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal menghapus kategori.');
    } finally {
      setBusy(null);
    }
  }

  async function toggleDeductsAnnual(t: LeaveType, checked: boolean) {
    if (!annual) return;
    setBusy(t.id);
    try {
      replace(await updateLeaveType(t.id, { deducts_from: checked ? annual.id : null }));
      toast.success(
        checked
          ? `${t.name} sekarang memotong kuota ${annual.name}.`
          : `${t.name} tidak lagi memotong kuota ${annual.name}.`
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal menyimpan.');
    } finally {
      setBusy(null);
    }
  }

  async function activate(t: LeaveType) {
    setBusy(t.id);
    try {
      replace(await updateLeaveType(t.id, { is_active: true }));
      toast.success(`Kategori "${t.name}" diaktifkan kembali.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal mengaktifkan.');
    } finally {
      setBusy(null);
    }
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) {
      toast.error('Nama kategori wajib diisi.');
      return;
    }
    if (!Number.isInteger(form.min_notice_days) || form.min_notice_days < 0) {
      toast.error('Minimal pengajuan harus angka hari ≥ 0.');
      return;
    }
    setBusy('new');
    try {
      const created = await createLeaveType({ ...form, name: form.name.trim(), description: form.description.trim() });
      onChanged([...types, created]);
      setForm(EMPTY);
      setAdding(false);
      toast.success(`Kategori "${created.name}" ditambahkan.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal menambah kategori.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <CardHeader className='flex-row items-start justify-between gap-3 space-y-0'>
        <div>
          <CardTitle>Kategori Izin & Cuti</CardTitle>
          <CardDescription>
            Tambah atau hapus kategori, pilih kategori yang memotong kuota Cuti Tahunan, dan atur minimal pengajuan
            (mis. 7 = paling lambat H-7; 0 = tanpa batas).
          </CardDescription>
        </div>
        {!adding && (
          <Button size='sm' onClick={() => setAdding(true)}>
            <Icons.add className='size-4' />
            Tambah Kategori
          </Button>
        )}
      </CardHeader>
      <CardContent className='space-y-4'>
        {adding && (
          <form onSubmit={create} className='bg-muted/40 grid grid-cols-1 gap-3 rounded-lg border p-4 md:grid-cols-4'>
            <div className='md:col-span-2'>
              <Label className='text-xs'>
                Nama Kategori <span className='text-destructive'>*</span>
              </Label>
              <Input
                autoFocus
                placeholder='mis. Izin Duka Cita'
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div>
              <Label className='text-xs'>Jenis</Label>
              <select
                className='border-input h-9 w-full rounded-lg border bg-transparent px-2.5 text-sm'
                value={form.kind}
                onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value }))}
              >
                <option value='LEAVE'>Cuti</option>
                <option value='PERMISSION'>Izin</option>
              </select>
            </div>
            <div>
              <Label className='text-xs'>Minimal Pengajuan (hari)</Label>
              <Input
                type='number'
                min={0}
                max={365}
                value={form.min_notice_days}
                onChange={(e) => setForm((f) => ({ ...f, min_notice_days: Number(e.target.value) }))}
              />
            </div>
            <div>
              <Label className='text-xs'>Kuota Tahunan (hari)</Label>
              <Input
                type='number'
                min={0}
                value={form.default_quota}
                onChange={(e) => setForm((f) => ({ ...f, default_quota: Number(e.target.value) }))}
              />
              <p className='text-muted-foreground mt-1 text-[11px]'>0 = tidak memotong kuota.</p>
            </div>
            <div className='md:col-span-3'>
              <Label className='text-xs'>Deskripsi</Label>
              <Input
                placeholder='Ketentuan singkat kategori ini'
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              />
            </div>
            <div className='flex flex-wrap items-center gap-4 text-sm md:col-span-4'>
              <label className='flex items-center gap-2'>
                <input
                  type='checkbox'
                  checked={form.is_paid}
                  onChange={(e) => setForm((f) => ({ ...f, is_paid: e.target.checked }))}
                />
                Dibayar
              </label>
              <label className='flex items-center gap-2'>
                <input
                  type='checkbox'
                  checked={form.requires_attachment}
                  onChange={(e) => setForm((f) => ({ ...f, requires_attachment: e.target.checked }))}
                />
                Wajib lampiran
              </label>
              {annual && (
                <label className='flex items-center gap-2'>
                  <input
                    type='checkbox'
                    checked={form.deducts_from === annual.id}
                    onChange={(e) => setForm((f) => ({ ...f, deducts_from: e.target.checked ? annual.id : null }))}
                  />
                  Potong kuota {annual.name}
                </label>
              )}
              <div className='ml-auto flex gap-2'>
                <Button
                  type='button'
                  variant='ghost'
                  size='sm'
                  onClick={() => {
                    setAdding(false);
                    setForm(EMPTY);
                  }}
                >
                  Batal
                </Button>
                <Button type='submit' size='sm' disabled={busy === 'new'}>
                  {busy === 'new' ? 'Menyimpan...' : 'Simpan Kategori'}
                </Button>
              </div>
            </div>
          </form>
        )}

        {inactiveCount > 0 && (
          <label className='text-muted-foreground flex items-center gap-2 text-xs'>
            <input type='checkbox' checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
            Tampilkan kategori nonaktif ({inactiveCount})
          </label>
        )}

        <div className='overflow-x-auto rounded-lg border'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className='pl-4'>Kategori</TableHead>
                <TableHead>Jenis</TableHead>
                <TableHead>Aturan Pengajuan</TableHead>
                <TableHead className='text-center'>Potong Kuota Cuti Tahunan</TableHead>
                <TableHead>Minimal Pengajuan (hari)</TableHead>
                <TableHead className='pr-4 text-right'>Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((t) => {
                const value = draft[t.id] ?? String(t.min_notice_days);
                const dirty = value !== String(t.min_notice_days);
                return (
                  <TableRow key={t.id} className={t.is_active ? undefined : 'opacity-60'}>
                    <TableCell className='pl-4'>
                      <div className='flex items-center gap-2'>
                        <span className='font-medium'>{t.name}</span>
                        {!t.is_active && <Badge variant='outline'>Nonaktif</Badge>}
                      </div>
                      <span className='text-muted-foreground text-xs'>{t.code}</span>
                    </TableCell>
                    <TableCell>{t.kind === 'PERMISSION' ? 'Izin' : 'Cuti'}</TableCell>
                    <TableCell>
                      {t.min_notice_days > 0 ? (
                        <Badge variant='secondary'>Paling lambat H-{t.min_notice_days}</Badge>
                      ) : (
                        <span className='text-muted-foreground text-sm'>Tanpa batas</span>
                      )}
                    </TableCell>
                    <TableCell className='text-center'>
                      {annual && t.id !== annual.id ? (
                        <input
                          type='checkbox'
                          className='size-4 cursor-pointer align-middle'
                          checked={t.deducts_from === annual.id}
                          disabled={!t.is_active || busy === t.id}
                          onChange={(e) => toggleDeductsAnnual(t, e.target.checked)}
                          aria-label={`${t.name} memotong kuota ${annual.name}`}
                          title={`Bila dicentang, hari ${t.name} yang disetujui memotong kuota ${annual.name}`}
                        />
                      ) : (
                        <span className='text-muted-foreground text-xs'>Kuota utama</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className='flex items-center gap-2'>
                        <Input
                          type='number'
                          min={0}
                          max={365}
                          className='h-8 w-20 text-right'
                          value={value}
                          disabled={!t.is_active}
                          onChange={(e) => setDraft((d) => ({ ...d, [t.id]: e.target.value }))}
                          aria-label={`Minimal pengajuan ${t.name}`}
                        />
                        <Button size='sm' variant='outline' disabled={!dirty || busy === t.id} onClick={() => saveNotice(t)}>
                          Simpan
                        </Button>
                      </div>
                    </TableCell>
                    <TableCell className='pr-4 text-right'>
                      {t.is_active ? (
                        <Button
                          size='sm'
                          variant='ghost'
                          className='text-destructive hover:text-destructive'
                          disabled={busy === t.id}
                          onClick={() => remove(t)}
                        >
                          <Icons.trash className='size-4' />
                          Hapus
                        </Button>
                      ) : (
                        <Button size='sm' variant='outline' disabled={busy === t.id} onClick={() => activate(t)}>
                          Aktifkan
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
              {visible.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className='text-muted-foreground py-8 text-center'>
                    Belum ada kategori.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
