'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Icons } from '@/components/icons';
import {
  RECOMMENDATION_LABELS,
  RATE_TYPE_LABELS,
  createAssignment,
  createEvent,
  createFreelancer,
  createSkill,
  createSkillCategory,
  deleteAssignment,
  deleteFreelancer,
  deleteFreelancerDocument,
  deleteSkill,
  deleteSkillCategory,
  getFreelancer,
  getFreelancerDocumentDownload,
  listEvents,
  listFreelancers,
  listSkillCategories,
  listSkills,
  removeFreelancerSkill,
  addFreelancerSkill,
  savePerformance,
  updateAssignment,
  updateFreelancer,
  uploadFreelancerDocument,
  type AssignmentInput,
  type EventAssignment,
  type Freelancer,
  type FreelancerDetail,
  type FreelancerStatus,
  type FreelanceEvent,
  type PerformanceInput,
  type RateType,
  type Recommendation,
  type Skill,
  type SkillCategory,
} from '@/lib/freelance';

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'Aktif',
  INACTIVE: 'Nonaktif',
  TERMINATED: 'Terminated',
};

const RECOMMENDATION_VARIANT: Record<Recommendation, 'default' | 'secondary' | 'destructive'> = {
  RECOMMENDED: 'default',
  RECOMMENDED_NOTES: 'secondary',
  NOT_RECOMMENDED: 'destructive',
};

function statusVariant(status: string): 'default' | 'secondary' | 'outline' {
  if (status === 'ACTIVE') return 'default';
  if (status === 'INACTIVE') return 'secondary';
  return 'outline';
}

function Stars({ value, editable, onChange }: { value: number | null; editable?: boolean; onChange?: (v: number) => void }) {
  if (value == null && !editable) return <span className='text-muted-foreground'>-</span>;
  const v = value ?? 0;
  return (
    <span className='inline-flex' aria-label={`${v} / 5`}>
      {Array.from({ length: 5 }).map((_, i) => (
        <button
          key={i}
          type='button'
          disabled={!editable}
          aria-label={`${i + 1} bintang`}
          onClick={() => editable && onChange?.(i + 1)}
          className={editable ? 'cursor-pointer' : 'cursor-default'}
        >
          <Icons.exclusive
            className={i < v ? 'text-amber-500' : 'text-muted-foreground/30'}
            size={14}
          />
        </button>
      ))}
    </span>
  );
}

function EventHistoryModal({
  open,
  onClose,
  freelancerId,
  events,
  edit,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  freelancerId: number;
  events: FreelanceEvent[];
  edit: EventAssignment | null;
  onSaved: () => void;
}) {
  const [eventId, setEventId] = useState<number | ''>(edit?.event ?? '');
  const [newEventName, setNewEventName] = useState('');
  const [assignedAt, setAssignedAt] = useState(edit?.assigned_at ?? '');
  const [role, setRole] = useState(edit?.role ?? '');
  const [pic, setPic] = useState(edit?.pic ?? '');
  const [rating, setRating] = useState(edit?.performance?.rating ?? 0);
  const [recommendation, setRecommendation] = useState<Recommendation | ''>(edit?.performance?.recommendation ?? '');
  const [notes, setNotes] = useState(edit?.performance?.notes ?? '');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setEventId(edit?.event ?? '');
      setNewEventName('');
      setAssignedAt(edit?.assigned_at ?? '');
      setRole(edit?.role ?? '');
      setPic(edit?.pic ?? '');
      setRating(edit?.performance?.rating ?? 0);
      setRecommendation(edit?.performance?.recommendation ?? '');
      setNotes(edit?.performance?.notes ?? '');
    }
  }, [open, edit]);

  if (!open) return null;

  const submit = async () => {
    if (!eventId && !newEventName.trim()) {
      toast.error('Pilih event atau buat event baru.');
      return;
    }
    setSaving(true);
    try {
      let evId = eventId;
      if (!evId && newEventName.trim()) {
        const ev = await createEvent({ name: newEventName.trim(), event_date: assignedAt || undefined });
        evId = ev.id;
      }
      const perf: PerformanceInput = {
        rating,
        recommendation: recommendation || undefined,
        notes: notes || undefined,
      };
      if (edit) {
        await updateAssignment(edit.id, {
          event: evId as number,
          assigned_at: assignedAt || undefined,
          role: role || undefined,
          pic: pic || undefined,
        });
        await savePerformance(edit.id, perf);
      } else {
        const created = await createAssignment({
          freelancer: freelancerId,
          event: evId as number,
          assigned_at: assignedAt || undefined,
          role: role || undefined,
          pic: pic || undefined,
        });
        await savePerformance(created.id, perf);
      }
      toast.success('Riwayat disimpan.');
      onSaved();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal simpan.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className='fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4'
    >
      <div role='dialog' className='w-full max-w-md rounded-2xl border bg-background p-5 shadow-sm'>
        <h3 className='mb-4 text-base font-semibold'>{edit ? 'Edit Riwayat Event' : 'Tambah Riwayat Event'}</h3>
        <div className='space-y-3'>
          <div>
            <label className='mb-1 block text-sm font-medium'>Event</label>
            <select
              className='w-full rounded-xl border bg-background px-3 py-2 text-sm'
              value={eventId}
              onChange={(e) => setEventId(e.target.value ? Number(e.target.value) : '')}
            >
              <option value=''>— Pilih event —</option>
              {events.map((ev) => (
                <option key={ev.id} value={ev.id}>{ev.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className='mb-1 block text-sm font-medium'>Atau buat event baru</label>
            <Input value={newEventName} onChange={(e) => setNewEventName(e.target.value)} placeholder='Nama event baru' />
          </div>
          <div>
            <label className='mb-1 block text-sm font-medium'>Tanggal</label>
            <Input type='date' value={assignedAt} onChange={(e) => setAssignedAt(e.target.value)} />
          </div>
          <div className='grid grid-cols-2 gap-3'>
            <div>
              <label className='mb-1 block text-sm font-medium'>Role</label>
              <Input value={role} onChange={(e) => setRole(e.target.value)} placeholder='Role' />
            </div>
            <div>
              <label className='mb-1 block text-sm font-medium'>PIC / Evaluator</label>
              <Input value={pic} onChange={(e) => setPic(e.target.value)} placeholder='PIC' />
            </div>
          </div>
          <div>
            <label className='mb-1 block text-sm font-medium'>Rating</label>
            <Stars value={rating} editable onChange={setRating} />
          </div>
          <div>
            <label className='mb-1 block text-sm font-medium'>Rekomendasi</label>
            <select
              className='w-full rounded-xl border bg-background px-3 py-2 text-sm'
              value={recommendation}
              onChange={(e) => setRecommendation(e.target.value as Recommendation | '')}
            >
              <option value=''>— Pilih —</option>
              <option value='RECOMMENDED'>Recommended</option>
              <option value='RECOMMENDED_NOTES'>Recommended with notes</option>
              <option value='NOT_RECOMMENDED'>Not recommended</option>
            </select>
          </div>
          <div>
            <label className='mb-1 block text-sm font-medium'>Catatan Performa</label>
            <textarea
              className='w-full rounded-xl border bg-background px-3 py-2 text-sm'
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </div>
        <div className='mt-5 flex justify-end gap-2'>
          <Button variant='ghost' onClick={onClose}>Batal</Button>
          <Button onClick={submit} disabled={saving}>
            {saving ? <Icons.spinner className='mr-1 animate-spin' size={16} /> : null}
            Simpan
          </Button>
        </div>
      </div>
    </div>
  );
}

function EditFreelancerModal({
  open,
  onClose,
  freelancer,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  freelancer: FreelancerDetail;
  onSaved: () => void;
}) {
  const [fullName, setFullName] = useState(freelancer.full_name);
  const [whatsapp, setWhatsapp] = useState(freelancer.whatsapp);
  const [personalEmail, setPersonalEmail] = useState(freelancer.personal_email);
  const [phone, setPhone] = useState(freelancer.phone ?? '');
  const [domicile, setDomicile] = useState(freelancer.domicile ?? '');
  const [rate, setRate] = useState(freelancer.rate != null ? String(freelancer.rate) : '');
  const [rateType, setRateType] = useState<RateType | ''>(freelancer.rate_type ?? '');
  const [status, setStatus] = useState<FreelancerStatus>(freelancer.status);
  const [isBlacklisted, setIsBlacklisted] = useState(freelancer.is_blacklisted);
  const [blacklistReason, setBlacklistReason] = useState(freelancer.blacklist_reason ?? '');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setFullName(freelancer.full_name);
      setWhatsapp(freelancer.whatsapp);
      setPersonalEmail(freelancer.personal_email);
      setPhone(freelancer.phone ?? '');
      setDomicile(freelancer.domicile ?? '');
      setRate(freelancer.rate != null ? String(freelancer.rate) : '');
      setRateType(freelancer.rate_type ?? '');
      setStatus(freelancer.status);
      setIsBlacklisted(freelancer.is_blacklisted);
      setBlacklistReason(freelancer.blacklist_reason ?? '');
    }
  }, [open, freelancer]);

  if (!open) return null;

  const submit = async () => {
    if (!fullName.trim()) {
      toast.error('Nama wajib diisi.');
      return;
    }
    if (isBlacklisted && !blacklistReason.trim()) {
      toast.error('Alasan blacklist wajib diisi.');
      return;
    }
    setSaving(true);
    try {
      await updateFreelancer(freelancer.id, {
        full_name: fullName.trim(),
        whatsapp: whatsapp || undefined,
        personal_email: personalEmail || undefined,
        phone: phone || undefined,
        domicile: domicile || undefined,
        rate: rate ? String(rate) : null,
        rate_type: rateType || undefined,
        status,
        is_blacklisted: isBlacklisted,
        blacklist_reason: isBlacklisted ? blacklistReason.trim() : '',
      });
      toast.success('Data freelancer diperbarui.');
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal simpan.');
    } finally {
      setSaving(false);
    }
  };

  return (    <div className='fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm'>
      <div role='dialog' aria-modal='true' className='w-full max-w-lg rounded-2xl border bg-background p-5 shadow-lg'>
        <div className='mb-4 flex items-center justify-between'>
          <h3 className='text-base font-semibold'>Edit Freelancer</h3>
          <button
            type='button'
            aria-label='Tutup'
            className='text-muted-foreground hover:text-foreground'
            onClick={onClose}
          >
            <Icons.close size={18} />
          </button>
        </div>
        <div className='max-h-[70vh] space-y-3 overflow-y-auto pr-1'>
          <div>
            <label className='mb-1 block text-sm font-medium'>Nama Lengkap *</label>
            <Input value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </div>
          <div className='grid grid-cols-2 gap-3'>
            <div>
              <label className='mb-1 block text-sm font-medium'>WhatsApp / HP</label>
              <Input value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} placeholder='WhatsApp' />
            </div>
            <div>
              <label className='mb-1 block text-sm font-medium'>Email</label>
              <Input value={personalEmail} onChange={(e) => setPersonalEmail(e.target.value)} placeholder='Email' />
            </div>
          </div>
          <div className='grid grid-cols-2 gap-3'>
            <div>
              <label className='mb-1 block text-sm font-medium'>Domisili</label>
              <Input value={domicile} onChange={(e) => setDomicile(e.target.value)} />
            </div>
            <div>
              <label className='mb-1 block text-sm font-medium'>Phone</label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder='Phone' />
            </div>
          </div>
          <div className='grid grid-cols-3 gap-3'>
            <div>
              <label className='mb-1 block text-sm font-medium'>Rate</label>
              <Input value={rate} onChange={(e) => setRate(e.target.value)} placeholder='0' inputMode='numeric' />
            </div>
            <div>
              <label className='mb-1 block text-sm font-medium'>Tipe Rate</label>
              <select
                className='w-full rounded-xl border bg-background px-3 py-2 text-sm'
                value={rateType}
                onChange={(e) => setRateType(e.target.value as RateType | '')}
              >
                <option value=''>—</option>
                <option value='PER_DAY'>Per Hari</option>
                <option value='PER_EVENT'>Per Event</option>
              </select>
            </div>
            <div>
              <label className='mb-1 block text-sm font-medium'>Status</label>
              <select
                className='w-full rounded-xl border bg-background px-3 py-2 text-sm'
                value={status}
                onChange={(e) => setStatus(e.target.value as FreelancerStatus)}
              >
                <option value='ACTIVE'>Active</option>
                <option value='INACTIVE'>Inactive</option>
                <option value='TERMINATED'>Terminated</option>
              </select>
            </div>
          </div>
          <div className='flex items-center gap-2'>
            <input
              type='checkbox'
              id='edit-blacklist'
              checked={isBlacklisted}
              onChange={(e) => setIsBlacklisted(e.target.checked)}
            />
            <label htmlFor='edit-blacklist' className='text-sm font-medium'>Blacklist</label>
          </div>
          {isBlacklisted && (
            <div>
              <label className='mb-1 block text-sm font-medium'>Alasan Blacklist *</label>
              <textarea
                className='w-full rounded-xl border bg-background px-3 py-2 text-sm'
                rows={2}
                value={blacklistReason}
                onChange={(e) => setBlacklistReason(e.target.value)}
              />
            </div>
          )}
        </div>
        <div className='mt-5 flex justify-end gap-2'>
          <Button variant='ghost' onClick={onClose}>Batal</Button>
          <Button onClick={submit} disabled={saving}>
            {saving ? <Icons.spinner className='mr-1 animate-spin' size={16} /> : null}
            Simpan
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function FreelancePage() {
  const [items, setItems] = useState<Freelancer[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [fStatus, setFStatus] = useState('');
  const [fSkill, setFSkill] = useState('');
  const [fRating, setFRating] = useState('');
  const [fRec, setFRec] = useState('');
  const [fBlacklist, setFBlacklist] = useState('');
  const [fEvent, setFEvent] = useState('');

  const [skills, setSkills] = useState<Skill[]>([]);
  const [categories, setCategories] = useState<SkillCategory[]>([]);

  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [detail, setDetail] = useState<FreelancerDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [skillModalOpen, setSkillModalOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [events, setEvents] = useState<FreelanceEvent[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    const params: Record<string, string> = {};
    if (search) params.search = search;
    if (fStatus) params.status = fStatus;
    if (fSkill) params.skill = fSkill;
    if (fRating) params.rating = fRating;
    if (fRec) params.recommendation = fRec;
    if (fBlacklist) params.is_blacklisted = fBlacklist;
    if (fEvent) params.event = fEvent;
    try {
      const data = await listFreelancers(params);
      setItems(data);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal memuat data.');
    } finally {
      setLoading(false);
    }
  }, [search, fStatus, fSkill, fRating, fRec, fBlacklist, fEvent]);

  // eslint-disable-next-line react/set-state-in-effect -- data fetch on filter change
  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    listSkills().then(setSkills).catch(() => {});
    listSkillCategories().then(setCategories).catch(() => {});
    listEvents().then(setEvents).catch(() => {});
  }, []);

  async function openDetail(id: number) {
    if (detailId === id) {
      setDetailId(null);
      setDetail(null);
      return;
    }
    setDetailId(id);
    setDetailLoading(true);
    setDetail(null);
    try {
      const d = await getFreelancer(id);
      setDetail(d);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal memuat detail.');
      setDetailId(null);
    } finally {
      setDetailLoading(false);
    }
  }

  function resetFilters() {
    setSearch('');
    setFStatus('');
    setFSkill('');
    setFRating('');
    setFRec('');
    setFBlacklist('');
    setFEvent('');
  }

  return (
    <div className='flex flex-1 flex-col gap-4 p-4 md:p-6'>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <div>
          <h2 className='text-2xl font-bold tracking-tight'>Freelance &amp; Talent Pool</h2>
          <p className='text-muted-foreground text-sm'>
            Database freelance terpusat untuk staffing event.
          </p>
        </div>
        <div className='flex gap-2'>
          <Button variant='outline' onClick={() => setSkillModalOpen(true)}>
            <Icons.adjustments className='mr-1' size={16} /> Skill &amp; Kategori
          </Button>
          <Button onClick={() => setQuickAddOpen(true)}>
            <Icons.add className='mr-1' size={16} /> Quick Add
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filter</CardTitle>
        </CardHeader>
        <CardContent>
          <div className='grid grid-cols-1 gap-3 md:grid-cols-3 lg:grid-cols-7'>
            <div className='lg:col-span-2'>
              <Label className='text-xs'>Cari</Label>
              <Input
                placeholder='Nama, HP, email, domisili...'
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div>
              <Label className='text-xs'>Status</Label>
              <select
                className='border-input h-9 w-full rounded-lg border bg-transparent px-2.5 text-sm'
                value={fStatus}
                onChange={(e) => setFStatus(e.target.value)}
              >
                <option value=''>Semua</option>
                {Object.entries(STATUS_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>
            <div>
              <Label className='text-xs'>Skill</Label>
              <select
                className='border-input h-9 w-full rounded-lg border bg-transparent px-2.5 text-sm'
                value={fSkill}
                onChange={(e) => setFSkill(e.target.value)}
              >
                <option value=''>Semua</option>
                {skills.map((s) => (
                  <option key={s.id} value={s.name}>{s.name}</option>
                ))}
              </select>
            </div>
            <div>
              <Label className='text-xs'>Rating min</Label>
              <select
                className='border-input h-9 w-full rounded-lg border bg-transparent px-2.5 text-sm'
                value={fRating}
                onChange={(e) => setFRating(e.target.value)}
              >
                <option value=''>Semua</option>
                {[5, 4, 3, 2, 1].map((r) => (
                  <option key={r} value={r}>{r}+</option>
                ))}
              </select>
            </div>
            <div>
              <Label className='text-xs'>Recommendation</Label>
              <select
                className='border-input h-9 w-full rounded-lg border bg-transparent px-2.5 text-sm'
                value={fRec}
                onChange={(e) => setFRec(e.target.value)}
              >
                <option value=''>Semua</option>
                {(Object.keys(RECOMMENDATION_LABELS) as Recommendation[]).map((r) => (
                  <option key={r} value={r}>{RECOMMENDATION_LABELS[r]}</option>
                ))}
              </select>
            </div>
            <div>
              <Label className='text-xs'>Blacklist</Label>
              <select
                className='border-input h-9 w-full rounded-lg border bg-transparent px-2.5 text-sm'
                value={fBlacklist}
                onChange={(e) => setFBlacklist(e.target.value)}
              >
                <option value=''>Semua</option>
                <option value='true'>Blacklist</option>
                <option value='false'>Tidak</option>
              </select>
            </div>
            <div>
              <Label className='text-xs'>Event / Project</Label>
              <select
                className='border-input h-9 w-full rounded-lg border bg-transparent px-2.5 text-sm'
                value={fEvent}
                onChange={(e) => setFEvent(e.target.value)}
              >
                <option value=''>Semua</option>
                {events.map((ev) => (
                  <option key={ev.id} value={ev.id}>{ev.name}</option>
                ))}
              </select>
            </div>
            <div className='flex items-end'>
              <Button variant='ghost' onClick={resetFilters}>Reset</Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Daftar Freelancer ({items.length})</CardTitle>
        </CardHeader>
        <CardContent className='p-0'>
          {loading && items.length === 0 ? (
            <div className='space-y-2 p-6'>
              <Skeleton className='h-8 w-full' />
              <Skeleton className='h-8 w-full' />
              <Skeleton className='h-8 w-full' />
            </div>
          ) : items.length === 0 ? (
            <p className='text-muted-foreground p-6 text-center'>Belum ada freelancer.</p>
          ) : (
            <div className='overflow-x-auto'>
              <table className='w-full text-sm'>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nama</TableHead>
                    <TableHead>Domisili</TableHead>
                    <TableHead>Skill</TableHead>
                    <TableHead>Event</TableHead>
                    <TableHead>Rate</TableHead>
                    <TableHead>Rating</TableHead>
                    <TableHead>Recommendation</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className='text-right'>Aksi</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((f) => (
                    <Fragment key={f.id}>
                    <TableRow>
                      <TableCell className='font-medium'>
                        <button
                          className='text-left hover:underline'
                          onClick={() => openDetail(f.id)}
                        >
                          {f.full_name}
                        </button>
                        {f.is_blacklisted && (
                          <Badge variant='destructive' className='ml-2'>Blacklist</Badge>
                        )}
                      </TableCell>
                      <TableCell>{f.domicile || '-'}</TableCell>
                      <TableCell>
                        <div className='flex flex-wrap gap-1'>
                          {f.skills.slice(0, 3).map((s) => (
                            <Badge key={s.id} variant='outline'>{s.name}</Badge>
                          ))}
                          {f.skills.length > 3 && (
                            <Badge variant='outline'>+{f.skills.length - 3}</Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className='flex flex-wrap gap-1'>
                          {f.events.length === 0 ? (
                            <span className='text-muted-foreground'>-</span>
                          ) : (
                            f.events.map((ev) => (
                              <Badge key={ev.id} variant='outline'>{ev.name}</Badge>
                            ))
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        {f.rate
                          ? `${Number(f.rate).toLocaleString('id-ID')}${f.rate_type ? ` / ${RATE_TYPE_LABELS[f.rate_type as keyof typeof RATE_TYPE_LABELS]}` : ''}`
                          : '-'}
                      </TableCell>
                      <TableCell><Stars value={f.avg_rating} /></TableCell>
                      <TableCell>
                        {f.recommendation ? (
                          <Badge variant={RECOMMENDATION_VARIANT[f.recommendation]}>
                            {RECOMMENDATION_LABELS[f.recommendation]}
                          </Badge>
                        ) : (
                          <span className='text-muted-foreground'>-</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={statusVariant(f.status)}>{STATUS_LABELS[f.status] ?? f.status}</Badge>
                      </TableCell>
                      <TableCell className='text-right'>
                        <div className='flex justify-end gap-1'>
                          <Button size='sm' variant='ghost' onClick={() => openDetail(f.id)}>
                            Detail
                          </Button>
                          <Button
                            size='sm'
                            variant='destructive'
                            onClick={async () => {
                              if (!window.confirm(`Hapus "${f.full_name}"?`)) return;
                              try {
                                await deleteFreelancer(f.id);
                                toast.success('Dihapus.');
                                await load();
                              } catch (err) {
                                toast.error(err instanceof Error ? err.message : 'Gagal menghapus.');
                              }
                            }}
                          >
                            Hapus
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                    {detailId === f.id && (
                      <TableRow className='hover:bg-transparent'>
                        <TableCell colSpan={9} className='p-0'>
                          <div className='border-t bg-muted/30 p-4 md:p-6'>
                            {detailLoading && detail?.id !== f.id ? (
                              <div className='space-y-3'>
                                <Skeleton className='h-8 w-1/2' />
                                <Skeleton className='h-40 w-full' />
                              </div>
                            ) : detail?.id === f.id ? (
                              <FreelancerDetailView
                                freelancer={detail}
                                skills={skills}
                                events={events}
                                onClose={() => { setDetailId(null); setDetail(null); }}
                                onChanged={async () => {
                                  const d = await getFreelancer(detail.id);
                                  setDetail(d);
                                  await load();
                                }}
                                onSkillAdded={async (skillId, note) => {
                                  await addFreelancerSkill(detail.id, skillId, note);
                                  const d = await getFreelancer(detail.id);
                                  setDetail(d);
                                }}
                                onSkillRemoved={async (skillId) => {
                                  await removeFreelancerSkill(detail.id, skillId);
                                  const d = await getFreelancer(detail.id);
                                  setDetail(d);
                                }}
                                onDocDeleted={async () => {
                                  const d = await getFreelancer(detail.id);
                                  setDetail(d);
                                }}
                                onEdit={() => setEditOpen(true)}
                                onAssignmentChanged={async () => {
                                  const d = await getFreelancer(detail.id);
                                  setDetail(d);
                                  await load();
                                }}
                              />
                            ) : null}
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                    </Fragment>
                  ))}
                </TableBody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <QuickAddModal
        open={quickAddOpen}
        onClose={() => setQuickAddOpen(false)}
        onCreated={async () => {
          setQuickAddOpen(false);
          await load();
          toast.success('Freelancer ditambahkan.');
        }}
      />

      <SkillCategoryModal
        open={skillModalOpen}
        onClose={() => setSkillModalOpen(false)}
        skills={skills}
        categories={categories}
        onChanged={async () => {
          const [s, c] = await Promise.all([listSkills(), listSkillCategories()]);
          setSkills(s);
          setCategories(c);
        }}
      />

      {detail && (
        <EditFreelancerModal
          open={editOpen}
          onClose={() => setEditOpen(false)}
          freelancer={detail}
          onSaved={async () => {
            setEditOpen(false);
            const d = await getFreelancer(detail.id);
            setDetail(d);
            await load();
          }}
        />
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className='min-w-0'>
      <p className='text-muted-foreground text-xs'>{label}</p>
      <p className='text-sm font-medium break-words'>{value || '-'}</p>
    </div>
  );
}

function QuickAddModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void | Promise<void>;
}) {
  const [full_name, setFullName] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [personal_email, setEmail] = useState('');
  const [domicile, setDomicile] = useState('');
  const [rate, setRate] = useState('');
  const [rate_type, setRateType] = useState('');
  const [saving, setSaving] = useState(false);

  function reset() {
    setFullName('');
    setWhatsapp('');
    setEmail('');
    setDomicile('');
    setRate('');
    setRateType('');
  }

  async function submit() {
    if (!full_name.trim()) {
      toast.error('Nama wajib diisi.');
      return;
    }
    setSaving(true);
    try {
      await createFreelancer({
        full_name: full_name.trim(),
        whatsapp: whatsapp || undefined,
        personal_email: personal_email || undefined,
        domicile: domicile || undefined,
        rate: rate || null,
        rate_type: (rate_type || '') as '' | 'PER_DAY' | 'PER_EVENT',
        status: 'ACTIVE',
      });
      reset();
      await onCreated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal menyimpan.');
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  return (
    <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4'>
      <div role='dialog' aria-modal='true' className='bg-popover w-full max-w-md rounded-2xl border p-5 shadow-lg'>
        <h3 className='mb-3 text-lg font-semibold'>Quick Add Freelancer</h3>
        <div className='space-y-3'>
          <div>
            <Label className='text-xs'>Nama *</Label>
            <Input value={full_name} onChange={(e) => setFullName(e.target.value)} placeholder='Nama lengkap' />
          </div>
          <div className='grid grid-cols-2 gap-3'>
            <div>
              <Label className='text-xs'>WhatsApp / HP</Label>
              <Input value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} />
            </div>
            <div>
              <Label className='text-xs'>Email</Label>
              <Input value={personal_email} onChange={(e) => setEmail(e.target.value)} />
            </div>
          </div>
          <div className='grid grid-cols-2 gap-3'>
            <div>
              <Label className='text-xs'>Domisili</Label>
              <Input value={domicile} onChange={(e) => setDomicile(e.target.value)} />
            </div>
            <div>
              <Label className='text-xs'>Rate</Label>
              <Input value={rate} onChange={(e) => setRate(e.target.value)} type='number' placeholder='0' />
            </div>
          </div>
          <div>
            <Label className='text-xs'>Tipe Rate</Label>
            <select
              className='border-input h-9 w-full rounded-lg border bg-transparent px-2.5 text-sm'
              value={rate_type}
              onChange={(e) => setRateType(e.target.value)}
            >
              <option value=''>-</option>
              <option value='PER_DAY'>Per Hari</option>
              <option value='PER_EVENT'>Per Event</option>
            </select>
          </div>
        </div>
        <div className='mt-4 flex justify-end gap-2'>
          <Button variant='ghost' onClick={onClose}>Batal</Button>
          <Button onClick={submit} disabled={saving}>
            {saving ? <Icons.spinner className='mr-1 animate-spin' size={16} /> : null}
            Simpan
          </Button>
        </div>
      </div>
    </div>
  );
}

function SkillCategoryModal({
  open,
  onClose,
  skills,
  categories,
  onChanged,
}: {
  open: boolean;
  onClose: () => void;
  skills: Skill[];
  categories: SkillCategory[];
  onChanged: () => void | Promise<void>;
}) {
  const [catName, setCatName] = useState('');
  const [skillName, setSkillName] = useState('');
  const [skillCat, setSkillCat] = useState('');

  if (!open) return null;

  return (
    <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4'>
      <div role='dialog' aria-modal='true' className='bg-popover w-full max-w-lg rounded-2xl border p-5 shadow-lg'>
        <h3 className='mb-3 text-lg font-semibold'>Skill &amp; Kategori</h3>
        <div className='grid grid-cols-1 gap-4 md:grid-cols-2'>
          <div>
            <Label className='text-xs'>Kategori baru</Label>
            <div className='flex gap-2'>
              <Input value={catName} onChange={(e) => setCatName(e.target.value)} placeholder='Mis. Talent' />
              <Button
                size='sm'
                onClick={async () => {
                  if (!catName.trim()) return;
                  try {
                    await createSkillCategory(catName.trim());
                    setCatName('');
                    await onChanged();
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : 'Gagal.');
                  }
                }}
              >
                <Icons.add size={16} />
              </Button>
            </div>
            <ul className='mt-2 max-h-40 space-y-1 overflow-y-auto text-sm'>
              {categories.map((c) => (
                <li key={c.id} className='flex items-center justify-between rounded-md border px-2 py-1'>
                  <span>{c.name} <span className='text-muted-foreground'>({c.skill_count})</span></span>
                  <Button
                    size='icon-sm'
                    variant='ghost'
                    onClick={async () => {
                      try {
                        await deleteSkillCategory(c.id);
                        await onChanged();
                      } catch (err) {
                        toast.error(err instanceof Error ? err.message : 'Gagal.');
                      }
                    }}
                  >
                    <Icons.trash size={14} />
                  </Button>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <Label className='text-xs'>Skill baru</Label>
            <div className='flex gap-2'>
              <Input value={skillName} onChange={(e) => setSkillName(e.target.value)} placeholder='Mis. MC' />
              <Button
                size='sm'
                onClick={async () => {
                  if (!skillName.trim()) return;
                  try {
                    await createSkill({ name: skillName.trim(), category: skillCat ? Number(skillCat) : null });
                    setSkillName('');
                    await onChanged();
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : 'Gagal.');
                  }
                }}
              >
                <Icons.add size={16} />
              </Button>
            </div>
            <select
              className='border-input mt-2 h-9 w-full rounded-lg border bg-transparent px-2.5 text-sm'
              value={skillCat}
              onChange={(e) => setSkillCat(e.target.value)}
            >
              <option value=''>Tanpa kategori</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <ul className='mt-2 max-h-32 space-y-1 overflow-y-auto text-sm'>
              {skills.map((s) => (
                <li key={s.id} className='flex items-center justify-between rounded-md border px-2 py-1'>
                  <span>{s.name} {s.category_name ? <span className='text-muted-foreground'>({s.category_name})</span> : null}</span>
                  <Button
                    size='icon-sm'
                    variant='ghost'
                    onClick={async () => {
                      try {
                        await deleteSkill(s.id);
                        await onChanged();
                      } catch (err) {
                        toast.error(err instanceof Error ? err.message : 'Gagal.');
                      }
                    }}
                  >
                    <Icons.trash size={14} />
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div className='mt-4 flex justify-end'>
          <Button variant='ghost' onClick={onClose}>Tutup</Button>
        </div>
      </div>
    </div>
  );
}

function FreelancerDetailView({
  freelancer,
  skills,
  events,
  onChanged,
  onSkillAdded,
  onSkillRemoved,
  onDocDeleted,
  onEdit,
  onClose,
  onAssignmentChanged,
}: {
  freelancer: FreelancerDetail;
  skills: Skill[];
  events: FreelanceEvent[];
  onChanged: () => void | Promise<void>;
  onSkillAdded: (skillId: number, note: string) => void | Promise<void>;
  onSkillRemoved: (skillId: number) => void | Promise<void>;
  onDocDeleted: () => void | Promise<void>;
  onEdit: () => void;
  onClose: () => void;
  onAssignmentChanged: () => void | Promise<void>;
}) {
  const [addingSkill, setAddingSkill] = useState(false);
  const [newSkill, setNewSkill] = useState('');
  const [docUrl, setDocUrl] = useState('');
  const [docName, setDocName] = useState('');
  const [docFile, setDocFile] = useState<File | null>(null);
  const [savingDoc, setSavingDoc] = useState(false);
  const [deletingDocId, setDeletingDocId] = useState<number | null>(null);
  const [viewingDocId, setViewingDocId] = useState<number | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyEdit, setHistoryEdit] = useState<EventAssignment | null>(null);
  const [historyDeletingId, setHistoryDeletingId] = useState<number | null>(null);

  const assignedSkillIds = new Set(freelancer.skills.map((s) => s.skill));

  const rateText = freelancer.rate
    ? `Rp${Number(freelancer.rate).toLocaleString('id-ID')}${freelancer.rate_type ? ` / ${RATE_TYPE_LABELS[freelancer.rate_type as keyof typeof RATE_TYPE_LABELS]}` : ''}`
    : null;

  return (
    <div className='space-y-4'>
      <div className='flex flex-wrap items-start justify-between gap-3'>
        <div className='min-w-0'>
          <h3 className='truncate text-lg font-semibold tracking-tight'>{freelancer.full_name}</h3>
          <div className='mt-1.5 flex flex-wrap items-center gap-1.5'>
            {freelancer.is_blacklisted ? (
              <Badge variant='destructive'>Blacklist</Badge>
            ) : (
              <Badge variant={statusVariant(freelancer.status)}>{STATUS_LABELS[freelancer.status] ?? freelancer.status}</Badge>
            )}
            {freelancer.recommendation && (
              <Badge variant={RECOMMENDATION_VARIANT[freelancer.recommendation]}>
                {RECOMMENDATION_LABELS[freelancer.recommendation]}
              </Badge>
            )}
          </div>
        </div>
        <div className='flex shrink-0 gap-2'>
          <Button variant='outline' size='sm' onClick={onEdit}>
            <Icons.edit size={14} /> Edit
          </Button>
          <Button variant='ghost' size='sm' onClick={onClose}>
            <Icons.close size={14} /> Tutup
          </Button>
        </div>
      </div>

      <div className='space-y-4'>
        <section className='rounded-xl border p-4'>
          <h4 className='mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground'>Informasi Kontak</h4>
          <div className='grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2'>
            <Field label='WhatsApp / HP' value={freelancer.whatsapp || freelancer.phone} />
            <Field label='Email' value={freelancer.personal_email} />
            <Field label='Domisili' value={freelancer.domicile} />
            <Field label='Contact Person' value={freelancer.contact_person} />
          </div>
        </section>

        <section className='rounded-xl border p-4'>
          <h4 className='mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground'>Rate &amp; Rating</h4>
          <div className='flex flex-wrap items-end justify-between gap-4'>
            <div className='min-w-0'>
              <p className='text-muted-foreground text-xs'>Rate</p>
              <p className='text-xl font-semibold tracking-tight'>{rateText ?? '-'}</p>
              {(freelancer.rate_min != null || freelancer.rate_max != null) && (
                <p className='text-muted-foreground mt-0.5 text-xs'>
                  Rentang: {freelancer.rate_min != null ? `Rp${Number(freelancer.rate_min).toLocaleString('id-ID')}` : '-'}
                  {' – '}
                  {freelancer.rate_max != null ? `Rp${Number(freelancer.rate_max).toLocaleString('id-ID')}` : '-'}
                </p>
              )}
            </div>
            <div>
              <p className='text-muted-foreground text-xs'>Avg Rating</p>
              <div className='mt-1'><Stars value={freelancer.avg_rating} /></div>
            </div>
          </div>
          {freelancer.is_blacklisted && (
            <div className='mt-3 rounded-lg border border-destructive/40 bg-destructive/5 p-2.5'>
              <p className='text-xs font-medium text-destructive'>Blacklist</p>
              <p className='text-sm'>{freelancer.blacklist_reason || '-'}</p>
            </div>
          )}
        </section>

        <section className='rounded-xl border p-4'>
          <h4 className='mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground'>Skill</h4>
          <div className='flex flex-wrap gap-1.5'>
            {freelancer.skills.map((s) => (
              <Badge key={s.id} variant='outline' className='max-w-full gap-1 py-1'>
                <span className='truncate'>{s.skill_name}</span>
                <button
                  type='button'
                  className='shrink-0 hover:text-destructive'
                  onClick={async (e) => {
                    e.stopPropagation();
                    if (!window.confirm(`Hapus skill "${s.skill_name}"?`)) return;
                    try {
                      await onSkillRemoved(s.skill);
                    } catch (err) {
                      toast.error(err instanceof Error ? err.message : 'Gagal hapus skill.');
                    }
                  }}
                  aria-label={`Hapus ${s.skill_name}`}
                >
                  <Icons.close size={12} />
                </button>
              </Badge>
            ))}
            {freelancer.skills.length === 0 && <span className='text-muted-foreground text-sm'>Belum ada skill.</span>}
          </div>
          <div className='mt-3 flex max-w-sm gap-2'>
            <select
              className='border-input h-9 min-w-0 flex-1 rounded-lg border bg-transparent px-2.5 text-sm'
              value={newSkill}
              onChange={(e) => setNewSkill(e.target.value)}
            >
              <option value=''>Tambah skill...</option>
              {skills.filter((s) => !assignedSkillIds.has(s.id)).map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
            <Button
              size='sm'
              className='shrink-0'
              disabled={!newSkill || addingSkill}
              onClick={async () => {
                if (!newSkill || addingSkill) return;
                setAddingSkill(true);
                try {
                  await onSkillAdded(Number(newSkill), '');
                  setNewSkill('');
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : 'Gagal tambah skill.');
                } finally {
                  setAddingSkill(false);
                }
              }}
            >
              {addingSkill ? <Icons.spinner className='animate-spin' size={16} /> : <Icons.add size={16} />}
            </Button>
          </div>
        </section>

        <section className='rounded-xl border p-4'>
          <h4 className='mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground'>CV / Portfolio</h4>
          {freelancer.documents.length === 0 ? (
            <p className='text-muted-foreground text-sm'>Belum ada dokumen.</p>
          ) : (
            <ul className='space-y-1.5'>
              {freelancer.documents.map((d) => (
                <li key={d.id} className='flex items-center justify-between gap-2 rounded-lg border px-3 py-2'>
                  <span className='flex min-w-0 flex-1 items-center gap-2'>
                    <Icons.page size={14} className='shrink-0 text-muted-foreground' />
                    <button
                      type='button'
                      className='truncate text-left text-sm text-primary hover:underline disabled:opacity-50'
                      disabled={viewingDocId === d.id}
                      onClick={async (e) => {
                        e.preventDefault();
                        setViewingDocId(d.id);
                        try {
                          const res = await getFreelancerDocumentDownload(freelancer.id, d.id);
                          if (!res.url) throw new Error('URL dokumen tidak tersedia.');
                          window.open(res.url, '_blank', 'noopener,noreferrer');
                        } catch (err) {
                          toast.error(err instanceof Error ? err.message : 'Gagal membuka dokumen.');
                        } finally {
                          setViewingDocId(null);
                        }
                      }}
                    >
                      {viewingDocId === d.id ? <Icons.spinner className='mr-1 inline animate-spin' size={14} /> : null}
                      {d.name}
                    </button>
                  </span>
                  <span className='flex shrink-0 items-center gap-1'>
                    <button
                      type='button'
                      className='text-muted-foreground hover:text-primary'
                      aria-label={`Buka ${d.name}`}
                      disabled={viewingDocId === d.id}
                      onClick={async () => {
                        setViewingDocId(d.id);
                        try {
                          const res = await getFreelancerDocumentDownload(freelancer.id, d.id);
                          if (!res.url) throw new Error('URL dokumen tidak tersedia.');
                          window.open(res.url, '_blank', 'noopener,noreferrer');
                        } catch (err) {
                          toast.error(err instanceof Error ? err.message : 'Gagal membuka dokumen.');
                        } finally {
                          setViewingDocId(null);
                        }
                      }}
                    >
                      {viewingDocId === d.id ? <Icons.spinner className='animate-spin' size={14} /> : <Icons.externalLink size={14} />}
                    </button>
                    <button
                      type='button'
                      className='text-muted-foreground hover:text-destructive'
                      aria-label={`Hapus ${d.name}`}
                      disabled={deletingDocId === d.id}
                      onClick={async () => {
                        if (!window.confirm(`Hapus dokumen "${d.name}"?`)) return;
                        setDeletingDocId(d.id);
                        try {
                          await deleteFreelancerDocument(freelancer.id, d.id);
                          await onDocDeleted();
                          toast.success('Dokumen dihapus.');
                        } catch (err) {
                          toast.error(err instanceof Error ? err.message : 'Gagal hapus.');
                        } finally {
                          setDeletingDocId(null);
                        }
                      }}
                    >
                      {deletingDocId === d.id ? <Icons.spinner className='animate-spin' size={14} /> : <Icons.trash size={14} />}
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
          <div className='mt-3 rounded-lg border border-dashed p-3'>
            <p className='text-muted-foreground mb-2 text-xs font-medium'>Tambah dokumen</p>
            <div className='grid grid-cols-1 gap-2 sm:grid-cols-2'>
              <Input value={docName} onChange={(e) => setDocName(e.target.value)} placeholder='Nama dokumen' />
              <Input type='file' className='min-w-0' onChange={(e) => setDocFile(e.target.files?.[0] ?? null)} />
            </div>
            <div className='mt-2 flex gap-2'>
              <Input
                className='min-w-0 flex-1'
                value={docUrl}
                onChange={(e) => setDocUrl(e.target.value)}
                placeholder='Atau URL portfolio (https://...)'
              />
              <Button
                size='sm'
                className='shrink-0'
                disabled={savingDoc || (!docUrl && !docFile)}
                onClick={async () => {
                  if (savingDoc) return;
                  setSavingDoc(true);
                  try {
                    await uploadFreelancerDocument(freelancer.id, {
                      doc_type: 'PORTFOLIO',
                      name: docName || docFile?.name || 'Document',
                      url: docUrl || undefined,
                      file: docFile || undefined,
                    });
                    setDocUrl('');
                    setDocName('');
                    setDocFile(null);
                    await onChanged();
                    toast.success('Dokumen ditambahkan.');
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : 'Gagal upload.');
                  } finally {
                    setSavingDoc(false);
                  }
                }}
              >
                {savingDoc ? <Icons.spinner className='mr-1 animate-spin' size={16} /> : null}
                Upload
              </Button>
            </div>
          </div>
        </section>

        <section className='rounded-xl border p-4'>
          <div className='mb-3 flex items-center justify-between gap-2'>
            <h4 className='text-xs font-semibold uppercase tracking-wide text-muted-foreground'>Riwayat Event &amp; Performa</h4>
            <Button variant='outline' size='sm' className='shrink-0' onClick={() => { setHistoryEdit(null); setHistoryOpen(true); }}>
              <Icons.add size={14} /> Tambah
            </Button>
          </div>
          {freelancer.assignments.length === 0 ? (
            <div className='flex flex-col items-center gap-1 rounded-lg border border-dashed py-6 text-center'>
              <Icons.calendar size={20} className='text-muted-foreground' />
              <p className='text-sm font-medium'>Belum ada riwayat event</p>
              <p className='text-muted-foreground text-xs'>Freelancer ini belum ditugaskan ke event mana pun.</p>
            </div>
          ) : (
            <div className='space-y-2'>
              {freelancer.assignments.map((a) => (
                <div key={a.id} className='rounded-lg border p-3'>
                  <div className='flex items-start justify-between gap-2'>
                    <div className='min-w-0'>
                      <p className='truncate text-sm font-medium'>{a.event_name}</p>
                      <p className='text-muted-foreground mt-0.5 text-xs'>
                        {a.role || '-'}{a.assigned_at ? ` · ${a.assigned_at}` : ''}
                      </p>
                    </div>
                    <div className='flex shrink-0 items-center gap-1'>
                      <button
                        type='button'
                        className='text-muted-foreground hover:text-primary'
                        aria-label='Edit riwayat'
                        onClick={() => { setHistoryEdit(a); setHistoryOpen(true); }}
                      >
                        <Icons.edit size={14} />
                      </button>
                      <button
                        type='button'
                        className='text-muted-foreground hover:text-destructive'
                        aria-label='Hapus riwayat'
                        disabled={historyDeletingId === a.id}
                        onClick={async () => {
                          setHistoryDeletingId(a.id);
                          try {
                            await deleteAssignment(a.id);
                            await onAssignmentChanged();
                            toast.success('Riwayat dihapus.');
                          } catch (err) {
                            toast.error(err instanceof Error ? err.message : 'Gagal hapus.');
                          } finally {
                            setHistoryDeletingId(null);
                          }
                        }}
                      >
                        {historyDeletingId === a.id ? <Icons.spinner className='animate-spin' size={14} /> : <Icons.trash size={14} />}
                      </button>
                    </div>
                  </div>
                  {a.pic && <p className='text-muted-foreground mt-1 text-xs'>PIC: {a.pic}</p>}
                  {a.performance && (
                    <div className='mt-2 flex flex-wrap items-center gap-2 border-t pt-2'>
                      <Stars value={a.performance.rating} />
                      {a.performance.recommendation && (
                        <Badge variant={RECOMMENDATION_VARIANT[a.performance.recommendation]}>
                          {RECOMMENDATION_LABELS[a.performance.recommendation]}
                        </Badge>
                      )}
                    </div>
                  )}
                  {a.performance?.notes && (
                    <p className='text-muted-foreground mt-1.5 text-xs'>{a.performance.notes}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <EventHistoryModal
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        freelancerId={freelancer.id}
        events={events}
        edit={historyEdit}
        onSaved={onAssignmentChanged}
      />
    </div>
  );
}
