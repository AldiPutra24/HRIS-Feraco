'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
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
  createFreelancer,
  createSkill,
  createSkillCategory,
  deleteFreelancer,
  deleteSkill,
  deleteSkillCategory,
  getFreelancer,
  listFreelancers,
  listSkillCategories,
  listSkills,
  removeFreelancerSkill,
  addFreelancerSkill,
  uploadFreelancerDocument,
  type Freelancer,
  type FreelancerDetail,
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

function Stars({ value }: { value: number | null }) {
  if (value == null) return <span className='text-muted-foreground'>-</span>;
  return (
    <span className='inline-flex' aria-label={`${value} / 5`}>
      {Array.from({ length: 5 }).map((_, i) => (
        <Icons.exclusive
          key={i}
          className={i < value ? 'text-amber-500' : 'text-muted-foreground/30'}
          size={14}
        />
      ))}
    </span>
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

  const [skills, setSkills] = useState<Skill[]>([]);
  const [categories, setCategories] = useState<SkillCategory[]>([]);

  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [detail, setDetail] = useState<FreelancerDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [skillModalOpen, setSkillModalOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const params: Record<string, string> = {};
    if (search) params.search = search;
    if (fStatus) params.status = fStatus;
    if (fSkill) params.skill = fSkill;
    if (fRating) params.rating = fRating;
    if (fRec) params.recommendation = fRec;
    if (fBlacklist) params.is_blacklisted = fBlacklist;
    try {
      const data = await listFreelancers(params);
      setItems(data);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal memuat data.');
    } finally {
      setLoading(false);
    }
  }, [search, fStatus, fSkill, fRating, fRec, fBlacklist]);

  // eslint-disable-next-line react/set-state-in-effect -- data fetch on filter change
  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    listSkills().then(setSkills).catch(() => {});
    listSkillCategories().then(setCategories).catch(() => {});
  }, []);

  async function openDetail(id: number) {
    setDetailLoading(true);
    setDetail(null);
    try {
      const d = await getFreelancer(id);
      setDetail(d);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal memuat detail.');
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
          <div className='grid grid-cols-1 gap-3 md:grid-cols-3 lg:grid-cols-6'>
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
                    <TableHead>Rate</TableHead>
                    <TableHead>Rating</TableHead>
                    <TableHead>Recommendation</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className='text-right'>Aksi</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((f) => (
                    <TableRow key={f.id}>
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

      <Sheet open={detail !== null || detailLoading} onOpenChange={(o) => { if (!o) setDetail(null); }}>
        <SheetContent side='right' className='w-full sm:max-w-2xl'>
          {detailLoading && !detail ? (
            <div className='space-y-3 p-6'>
              <Skeleton className='h-8 w-1/2' />
              <Skeleton className='h-40 w-full' />
            </div>
          ) : detail ? (
            <FreelancerDetailView
              freelancer={detail}
              skills={skills}
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
            />
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className='text-muted-foreground text-xs'>{label}</p>
      <p className='text-sm font-medium'>{value || '-'}</p>
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
    <button type='button' aria-label='Tutup' className='fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4' onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
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
    </button>
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
    <button type='button' aria-label='Tutup' className='fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4' onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
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
    </button>
  );
}

function FreelancerDetailView({
  freelancer,
  skills,
  onChanged,
  onSkillAdded,
  onSkillRemoved,
}: {
  freelancer: FreelancerDetail;
  skills: Skill[];
  onChanged: () => void | Promise<void>;
  onSkillAdded: (skillId: number, note: string) => void | Promise<void>;
  onSkillRemoved: (skillId: number) => void | Promise<void>;
}) {
  const [newSkill, setNewSkill] = useState('');
  const [docUrl, setDocUrl] = useState('');
  const [docName, setDocName] = useState('');
  const [docFile, setDocFile] = useState<File | null>(null);
  const [savingDoc, setSavingDoc] = useState(false);

  const assignedSkillIds = new Set(freelancer.skills.map((s) => s.id));

  return (
    <div className='flex h-full flex-col'>
      <SheetHeader>
        <SheetTitle>{freelancer.full_name}</SheetTitle>
        <SheetDescription>
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
        </SheetDescription>
      </SheetHeader>

      <div className='flex-1 space-y-5 overflow-y-auto px-4 pb-4'>
        <section className='grid grid-cols-2 gap-3 md:grid-cols-3'>
          <Field label='WhatsApp' value={freelancer.whatsapp} />
          <Field label='Email' value={freelancer.personal_email} />
          <Field label='Domisili' value={freelancer.domicile} />
          <Field label='Phone' value={freelancer.phone} />
          <Field label='Contact Person' value={freelancer.contact_person} />
          <Field
            label='Rate'
            value={
              freelancer.rate
                ? `${Number(freelancer.rate).toLocaleString('id-ID')}${freelancer.rate_type ? ` / ${RATE_TYPE_LABELS[freelancer.rate_type as keyof typeof RATE_TYPE_LABELS]}` : ''}`
                : '-'
            }
          />
          {freelancer.rate_min != null && <Field label='Rate Min' value={Number(freelancer.rate_min).toLocaleString('id-ID')} />}
          {freelancer.rate_max != null && <Field label='Rate Max' value={Number(freelancer.rate_max).toLocaleString('id-ID')} />}
          <Field label='Avg Rating' value={<Stars value={freelancer.avg_rating} />} />
        </section>

        {freelancer.is_blacklisted && (
          <section className='rounded-lg border border-destructive/40 bg-destructive/5 p-3'>
            <p className='text-xs font-medium text-destructive'>Blacklist</p>
            <p className='text-sm'>{freelancer.blacklist_reason || '-'}</p>
          </section>
        )}

        <section>
          <h4 className='mb-2 text-sm font-semibold'>Skill</h4>
          <div className='flex flex-wrap gap-1'>
            {freelancer.skills.map((s) => (
              <Badge key={s.id} variant='outline' className='gap-1'>
                {s.name}
                <button
                  className='hover:text-destructive'
                  onClick={() => onSkillRemoved(s.id)}
                  aria-label={`Hapus ${s.name}`}
                >
                  <Icons.close size={12} />
                </button>
              </Badge>
            ))}
            {freelancer.skills.length === 0 && <span className='text-muted-foreground text-sm'>-</span>}
          </div>
          <div className='mt-2 flex gap-2'>
            <select
              className='border-input h-9 w-full rounded-lg border bg-transparent px-2.5 text-sm'
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
              disabled={!newSkill}
              onClick={async () => {
                if (!newSkill) return;
                await onSkillAdded(Number(newSkill), '');
                setNewSkill('');
              }}
            >
              <Icons.add size={16} />
            </Button>
          </div>
        </section>

        <section>
          <h4 className='mb-2 text-sm font-semibold'>CV / Portfolio</h4>
          <ul className='space-y-1 text-sm'>
            {freelancer.documents.map((d) => (
              <li key={d.id} className='flex items-center justify-between rounded-md border px-2 py-1'>
                <span className='flex items-center gap-2'>
                  <Icons.page size={14} />
                  {d.url ? (
                    <a href={d.url} target='_blank' rel='noreferrer' className='text-primary hover:underline'>{d.name}</a>
                  ) : d.download_url ? (
                    <a href={d.download_url} target='_blank' rel='noreferrer' className='text-primary hover:underline'>{d.name}</a>
                  ) : (
                    <span>{d.name}</span>
                  )}
                </span>
              </li>
            ))}
            {freelancer.documents.length === 0 && <li className='text-muted-foreground'>-</li>}
          </ul>
          <div className='mt-2 grid grid-cols-1 gap-2 md:grid-cols-2'>
            <Input value={docName} onChange={(e) => setDocName(e.target.value)} placeholder='Nama dokumen' />
            <Input type='file' onChange={(e) => setDocFile(e.target.files?.[0] ?? null)} />
          </div>
          <div className='mt-2 flex gap-2'>
            <Input
              value={docUrl}
              onChange={(e) => setDocUrl(e.target.value)}
              placeholder='Atau URL portfolio (https://...)'
            />
            <Button
              size='sm'
              disabled={savingDoc || (!docUrl && !docFile)}
              onClick={async () => {
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
        </section>

        <section>
          <h4 className='mb-2 text-sm font-semibold'>Riwayat Event &amp; Performa</h4>
          {freelancer.assignments.length === 0 ? (
            <p className='text-muted-foreground text-sm'>-</p>
          ) : (
            <div className='space-y-2'>
              {freelancer.assignments.map((a) => (
                <div key={a.id} className='rounded-lg border p-3'>
                  <div className='flex items-center justify-between'>
                    <p className='text-sm font-medium'>{a.event_name}</p>
                    <span className='text-muted-foreground text-xs'>{a.role || '-'}</span>
                  </div>
                  <p className='text-muted-foreground text-xs'>PIC: {a.pic || '-'} {a.assigned_at ? `· ${a.assigned_at}` : ''}</p>
                  {a.performance && (
                    <div className='mt-1 flex flex-wrap items-center gap-2'>
                      <Stars value={a.performance.rating} />
                      {a.performance.recommendation && (
                        <Badge variant={RECOMMENDATION_VARIANT[a.performance.recommendation]}>
                          {RECOMMENDATION_LABELS[a.performance.recommendation]}
                        </Badge>
                      )}
                      {a.performance.notes && (
                        <span className='text-muted-foreground text-xs'>{a.performance.notes}</span>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
