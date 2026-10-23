'use client';

import { useEffect, useMemo, useState } from 'react';
import { toast } from 'react-toastify';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Icons } from '@/components/icons';
import { cn } from '@/lib/utils';
import type { Employee } from '@/lib/employees';
import {
  CHANGE_STATUS_VARIANT,
  REQUEST_FIELD_MAP,
  REQUEST_GROUPS,
  SELF_EDIT_FIELDS,
  cancelMyChangeRequest,
  submitChangeRequest,
  updateMyContact,
  type ChangeRequest,
  type SelfEditField
} from '@/lib/profile-changes';

const SELECT_CLASS = 'border-input h-9 w-full rounded-lg border bg-transparent px-2.5 text-sm';
const LINK_CLASS = 'text-primary inline-flex items-center gap-1 text-xs font-medium hover:underline';
// Same rule as the backend: PDF or image, max 5 MB (real bytes are checked server-side).
const ATTACHMENT_ACCEPT = 'application/pdf,.pdf,image/jpeg,.jpg,.jpeg,image/png,.png,image/webp,.webp';
const ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;
const STATUS_DOT: Record<ChangeRequest['status'], string> = {
  PENDING: 'bg-amber-500',
  APPROVED: 'bg-emerald-500',
  REJECTED: 'bg-red-500',
  CANCELLED: 'bg-slate-400'
};

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
}

/** Direct edit of contact data (address, phone, emails, emergency contact). */
export function ContactEditSheet({
  employee,
  open,
  onOpenChange,
  onSaved
}: {
  employee: Employee;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const initial = useMemo(
    () => Object.fromEntries(SELF_EDIT_FIELDS.map(({ field }) => [field, (employee[field] as string | null) ?? ''])),
    [employee]
  ) as Record<SelfEditField, string>;
  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setForm(initial);
  }, [open, initial]);

  async function save() {
    const changed = Object.fromEntries(
      SELF_EDIT_FIELDS.map(({ field }) => [field, form[field].trim()]).filter(([field, v]) => v !== initial[field as SelfEditField])
    );
    if (Object.keys(changed).length === 0) {
      onOpenChange(false);
      return;
    }
    setSaving(true);
    try {
      await updateMyContact(changed);
      toast.success('Data kontak diperbarui.');
      onOpenChange(false);
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal menyimpan.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side='right' className='w-full overflow-y-auto sm:max-w-md'>
        <SheetHeader>
          <SheetTitle>Edit Data Kontak</SheetTitle>
          <SheetDescription>Perubahan langsung tersimpan tanpa persetujuan HR.</SheetDescription>
        </SheetHeader>
        <div className='space-y-3 px-4'>
          {SELF_EDIT_FIELDS.map(({ field, label }) => (
            <div key={field} className='space-y-1.5'>
              <Label htmlFor={`edit-${field}`}>{label}</Label>
              {field === 'address' ? (
                <textarea
                  id={`edit-${field}`}
                  rows={3}
                  className='border-input w-full rounded-lg border bg-transparent px-2.5 py-2 text-sm'
                  value={form[field]}
                  onChange={(e) => setForm((f) => ({ ...f, [field]: e.target.value }))}
                />
              ) : (
                <Input
                  id={`edit-${field}`}
                  type={field === 'personal_email' ? 'email' : field.endsWith('phone') ? 'tel' : 'text'}
                  value={form[field]}
                  onChange={(e) => setForm((f) => ({ ...f, [field]: e.target.value }))}
                />
              )}
              {field === 'personal_email' && (
                <p className='text-muted-foreground text-xs'>Pemberitahuan perubahan dikirim ke email lama dan baru.</p>
              )}
            </div>
          ))}
        </div>
        <SheetFooter className='flex-row justify-end gap-2'>
          <Button variant='ghost' onClick={() => onOpenChange(false)}>
            Batal
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? 'Menyimpan...' : 'Simpan'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

/** Request a change of protected data (approved by HR Staff / HR Lead / Admin). */
export function ChangeRequestSheet({
  employee,
  pendingFields,
  open,
  onOpenChange,
  onSubmitted
}: {
  employee: Employee;
  pendingFields: Set<string>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmitted: () => void;
}) {
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [note, setNote] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setSelected({});
      setNote('');
      setFile(null);
    }
  }, [open]);

  const needsAttachment = Object.keys(selected).some((f) => REQUEST_FIELD_MAP[f]?.needsAttachment);

  function toggle(field: string, on: boolean) {
    setSelected((s) => {
      const next = { ...s };
      if (on) next[field] = '';
      else delete next[field];
      return next;
    });
  }

  async function submit() {
    const fields = Object.keys(selected);
    if (fields.length === 0) {
      toast.error('Pilih minimal satu data yang ingin diubah.');
      return;
    }
    const empty = fields.filter((f) => !selected[f].trim()).map((f) => REQUEST_FIELD_MAP[f].label);
    if (empty.length) {
      toast.error(`Isi nilai baru untuk: ${empty.join(', ')}.`);
      return;
    }
    if (needsAttachment && !file) {
      toast.error('Dokumen pendukung wajib dilampirkan.');
      return;
    }
    if (file && file.size > ATTACHMENT_MAX_BYTES) {
      toast.error('Dokumen pendukung maksimal 5 MB.');
      return;
    }
    setSaving(true);
    try {
      await submitChangeRequest(
        Object.fromEntries(fields.map((f) => [f, selected[f].trim()])),
        note.trim(),
        file
      );
      toast.success('Pengajuan terkirim. HR akan meninjau perubahan Anda.');
      onOpenChange(false);
      onSubmitted();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal mengirim pengajuan.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side='right' className='w-full overflow-y-auto sm:max-w-lg'>
        <SheetHeader>
          <SheetTitle>Ajukan Perubahan Data</SheetTitle>
          <SheetDescription>Data ini diperbarui setelah disetujui HR. Centang data yang ingin diubah.</SheetDescription>
        </SheetHeader>
        <div className='space-y-5 px-4'>
          {REQUEST_GROUPS.map((group) => (
            <div key={group.title} className='space-y-2'>
              <div>
                <p className='text-sm font-semibold'>{group.title}</p>
                <p className='text-muted-foreground text-xs'>{group.hint}</p>
              </div>
              {group.fields.map((def) => {
                const pending = pendingFields.has(def.field);
                const checked = def.field in selected;
                const current = (employee[def.field as keyof Employee] as string | null) ?? '';
                return (
                  <div key={def.field} className='rounded-lg border p-3'>
                    <div className='flex items-center gap-2'>
                      <Checkbox
                        id={`req-${def.field}`}
                        checked={checked}
                        disabled={pending}
                        onCheckedChange={(on: boolean) => toggle(def.field, on === true)}
                      />
                      <Label htmlFor={`req-${def.field}`} className='text-sm font-medium'>
                        {def.label}
                      </Label>
                      {pending && (
                        <Badge variant='secondary' className='ml-auto'>
                          Menunggu persetujuan
                        </Badge>
                      )}
                    </div>
                    {checked && (
                      <div className='mt-2 space-y-1.5'>
                        <p className='text-muted-foreground text-xs'>
                          Saat ini:{' '}
                          {(def.options?.find((o) => o.value === current)?.label ?? current) || '-'}
                        </p>
                        {def.type === 'select' ? (
                          <select
                            className={SELECT_CLASS}
                            value={selected[def.field]}
                            onChange={(e) => setSelected((s) => ({ ...s, [def.field]: e.target.value }))}
                          >
                            <option value=''>Pilih {def.label.toLowerCase()}</option>
                            {def.options?.map((o) => (
                              <option key={o.value} value={o.value}>
                                {o.label}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <Input
                            type={def.type === 'date' ? 'date' : 'text'}
                            placeholder={`${def.label} baru`}
                            value={selected[def.field]}
                            onChange={(e) => setSelected((s) => ({ ...s, [def.field]: e.target.value }))}
                          />
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}

          <div className='space-y-1.5'>
            <Label>
              Dokumen Pendukung {needsAttachment && <span className='text-destructive'>*</span>}
            </Label>
            <input
              type='file'
              accept={ATTACHMENT_ACCEPT}
              className='text-muted-foreground file:bg-primary file:text-primary-foreground hover:file:bg-primary/80 block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:px-3 file:py-1.5 file:text-sm file:font-medium'
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            <p className='text-muted-foreground text-xs'>PDF, JPG, PNG, atau WEBP · maks. 5 MB</p>
          </div>
          <div className='space-y-1.5'>
            <Label htmlFor='req-note'>Catatan (opsional)</Label>
            <textarea
              id='req-note'
              rows={2}
              className='border-input w-full rounded-lg border bg-transparent px-2.5 py-2 text-sm'
              placeholder='Mis. ganti KTP karena pindah domisili'
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
        </div>
        <SheetFooter className='flex-row justify-end gap-2'>
          <Button variant='ghost' onClick={() => onOpenChange(false)}>
            Batal
          </Button>
          <Button onClick={submit} disabled={saving}>
            {saving ? 'Mengirim...' : 'Kirim Pengajuan'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

/** Employee's own request history (latest first) with cancel for PENDING. */
export function ChangeRequestHistory({ items, onChanged }: { items: ChangeRequest[]; onChanged: () => void }) {
  const [busy, setBusy] = useState<number | null>(null);

  async function cancel(cr: ChangeRequest) {
    if (!window.confirm('Batalkan pengajuan perubahan data ini?')) return;
    setBusy(cr.id);
    try {
      await cancelMyChangeRequest(cr.id);
      toast.success('Pengajuan dibatalkan.');
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal membatalkan.');
    } finally {
      setBusy(null);
    }
  }

  if (items.length === 0) return null;
  return (
    <Card className='gap-0 py-0'>
      <div className='flex items-center gap-2.5 border-b px-5 py-3.5'>
        <span className='bg-primary/10 text-primary flex size-8 items-center justify-center rounded-lg'>
          <Icons.clock className='size-4' />
        </span>
        <div>
          <h3 className='text-sm font-semibold'>Riwayat Pengajuan Perubahan Data</h3>
          <p className='text-muted-foreground text-xs'>{items.length} pengajuan terakhir</p>
        </div>
      </div>
      <CardContent className='px-5 py-4'>
        <ol className='relative space-y-4 border-l pl-5'>
          {items.map((cr) => (
            <li key={cr.id} className='relative'>
              <span
                className={cn(
                  'ring-background absolute top-1.5 -left-[25px] size-2.5 rounded-full ring-4',
                  STATUS_DOT[cr.status]
                )}
              />
              <div className='flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between'>
                <div className='min-w-0 space-y-1.5'>
                  <div className='flex flex-wrap items-center gap-2'>
                    <Badge variant={CHANGE_STATUS_VARIANT[cr.status]}>{cr.status_display}</Badge>
                    <span className='text-muted-foreground text-xs'>
                      Diajukan {fmtDateTime(cr.created_at)}
                      {cr.reviewed_at ? ` · diproses ${fmtDateTime(cr.reviewed_at)}` : ''}
                    </span>
                  </div>
                  {cr.items.map((it) => (
                    <p key={it.field} className='text-sm break-words'>
                      <span className='text-muted-foreground'>{it.label}:</span>{' '}
                      <span className='text-muted-foreground line-through decoration-1'>{it.old || '-'}</span>{' '}
                      <Icons.arrowRight className='text-muted-foreground inline size-3' />{' '}
                      <span className='font-medium'>{it.new || '-'}</span>
                    </p>
                  ))}
                  {cr.note && <p className='text-muted-foreground text-xs'>Catatan: {cr.note}</p>}
                  {cr.status === 'REJECTED' && cr.rejection_reason && (
                    <p className='text-destructive text-xs'>Alasan ditolak: {cr.rejection_reason}</p>
                  )}
                </div>
                <div className='flex shrink-0 items-center gap-3'>
                  {cr.attachment_url && (
                    <a href={cr.attachment_url} target='_blank' rel='noreferrer' title={cr.attachment_name} className={LINK_CLASS}>
                      <Icons.paperclip className='size-3.5' />
                      Lampiran
                    </a>
                  )}
                  {cr.status === 'PENDING' && (
                    <Button size='sm' variant='outline' disabled={busy === cr.id} onClick={() => cancel(cr)}>
                      Batalkan
                    </Button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
