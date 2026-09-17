'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { toast } from 'react-toastify';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Icons } from '@/components/icons';
import {
  TASK_STATUS_LABELS,
  createAssignment,
  createEvent,
  deleteAssignment,
  deleteEvent,
  getEventTaskProgress,
  listAssignments,
  listEvents,
  listFreelancers,
  savePerformance,
  updateAssignment,
  updateEvent,
  type EventAssignment,
  type EventTaskProgress,
  type FreelanceEvent,
  type Freelancer,
  type Recommendation,
  type TaskStatus,
} from '@/lib/freelance';

const STATUS_VARIANT: Record<TaskStatus, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  BELUM_MULAI: 'outline',
  SEDANG_DIKERJAKAN: 'secondary',
  SELESAI: 'default',
  TERKENDALA: 'destructive',
};

const STATUS_ORDER: TaskStatus[] = ['SELESAI', 'SEDANG_DIKERJAKAN', 'BELUM_MULAI', 'TERKENDALA'];

const RECOMMENDATION_LABELS: Record<string, string> = {
  RECOMMENDED: 'Recommended',
  RECOMMENDED_NOTES: 'Recommended with Notes',
  NOT_RECOMMENDED: 'Not Recommended',
};

function fmtDate(d: string | null): string {
  if (!d) return '-';
  return new Date(d).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
}

function RatingStars({ rating }: { rating: number | null }) {
  if (!rating) return <span className="text-muted-foreground text-xs">-</span>;
  return (
    <span className="inline-flex items-center gap-0.5" title={`${rating}/5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Icons.exclusive
          key={i}
          size={13}
          className={i <= Math.round(rating) ? 'text-amber-500' : 'text-muted-foreground/30'}
        />
      ))}
    </span>
  );
}

function EventModal({
  onClose,
  edit,
  onSaved,
}: {
  onClose: () => void;
  edit: FreelanceEvent | null;
  onSaved: () => void;
}) {
  const [name, setName] = useState(edit?.name ?? '');
  const [eventDate, setEventDate] = useState(edit?.event_date ?? '');
  const [location, setLocation] = useState(edit?.location ?? '');
  const [client, setClient] = useState(edit?.client ?? '');
  const [description, setDescription] = useState(edit?.description ?? '');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!name.trim()) {
      toast.error('Nama event wajib diisi.');
      return;
    }
    setSaving(true);
    try {
      const input = {
        name: name.trim(),
        event_date: eventDate || null,
        location: location.trim(),
        client: client.trim(),
        description: description.trim(),
      };
      if (edit) {
        await updateEvent(edit.id, input);
      } else {
        await createEvent(input);
      }
      toast.success(edit ? 'Event diperbarui.' : 'Event dibuat.');
      onSaved();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal menyimpan event.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
    >
      <div role="dialog" className="w-full max-w-lg rounded-2xl border bg-background p-5 shadow-sm">
        <h3 className="mb-4 text-base font-semibold">{edit ? 'Edit Event' : 'Tambah Event'}</h3>
        <div className="space-y-3">
          <div>
            <Label className="mb-1 block text-sm font-medium" htmlFor="event-name">Nama Event *</Label>
            <Input id="event-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Nama event" />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label className="mb-1 block text-sm font-medium" htmlFor="event-date">Tanggal</Label>
              <Input id="event-date" type="date" value={eventDate} onChange={(e) => setEventDate(e.target.value)} />
            </div>
            <div>
              <Label className="mb-1 block text-sm font-medium" htmlFor="event-client">Klien</Label>
              <Input id="event-client" value={client} onChange={(e) => setClient(e.target.value)} placeholder="Nama klien" />
            </div>
          </div>
          <div>
            <Label className="mb-1 block text-sm font-medium" htmlFor="event-location">Lokasi</Label>
            <Input id="event-location" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Lokasi event" />
          </div>
          <div>
            <Label className="mb-1 block text-sm font-medium" htmlFor="event-desc">Deskripsi</Label>
            <textarea
              id="event-desc"
              className="w-full rounded-xl border bg-background px-3 py-2 text-sm"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Deskripsi event (opsional)"
            />
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Batal</Button>
          <Button onClick={submit} disabled={saving}>
            {saving && <Icons.spinner className="mr-1" size={16} />}
            {edit ? 'Simpan' : 'Buat'}
          </Button>
        </div>
      </div>
    </div>
  );
}

function AssignmentModal({
  onClose,
  event,
  edit,
  freelancers,
  onSaved,
}: {
  onClose: () => void;
  event: FreelanceEvent;
  edit: EventAssignment | null;
  freelancers: Freelancer[];
  onSaved: () => void;
}) {
  const [freelancerId, setFreelancerId] = useState<number | ''>(edit?.freelancer ?? '');
  const [assignedAt, setAssignedAt] = useState(edit?.assigned_at ?? '');
  const [role, setRole] = useState(edit?.role ?? '');
  const [pic, setPic] = useState(edit?.pic ?? '');
  const [rating, setRating] = useState(edit?.performance?.rating ?? 0);
  const [recommendation, setRecommendation] = useState<Recommendation | ''>(edit?.performance?.recommendation ?? '');
  const [notes, setNotes] = useState(edit?.performance?.notes ?? '');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!freelancerId) {
      toast.error('Pilih freelancer.');
      return;
    }
    setSaving(true);
    try {
      const perf = {
        rating,
        recommendation: recommendation || undefined,
        notes: notes || undefined,
      };
      if (edit) {
        await updateAssignment(edit.id, {
          freelancer: freelancerId as number,
          event: event.id,
          assigned_at: assignedAt || undefined,
          role: role || undefined,
          pic: pic || undefined,
        });
        await savePerformance(edit.id, perf);
      } else {
        const created = await createAssignment({
          freelancer: freelancerId as number,
          event: event.id,
          assigned_at: assignedAt || undefined,
          role: role || undefined,
          pic: pic || undefined,
        });
        await savePerformance(created.id, perf);
      }
      toast.success('Penugasan disimpan.');
      onSaved();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal menyimpan penugasan.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
    >
      <div role="dialog" className="w-full max-w-lg rounded-2xl border bg-background p-5 shadow-sm">
        <h3 className="mb-1 text-base font-semibold">
          {edit ? 'Edit Penugasan' : 'Tambah Penugasan'}
        </h3>
        <p className="text-muted-foreground mb-4 text-xs">{event.name}</p>
        <div className="space-y-3">
          <div>
            <Label className="mb-1 block text-sm font-medium" htmlFor="asg-freelancer">Freelancer *</Label>
            <select
              id="asg-freelancer"
              className="w-full rounded-xl border bg-background px-3 py-2 text-sm"
              value={freelancerId}
              onChange={(e) => setFreelancerId(e.target.value ? Number(e.target.value) : '')}
            >
              <option value="">{'\u2014 Pilih freelancer \u2014'}</option>
              {freelancers.map((f) => (
                <option key={f.id} value={f.id}>{f.full_name}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label className="mb-1 block text-sm font-medium" htmlFor="asg-date">Tanggal</Label>
              <Input id="asg-date" type="date" value={assignedAt} onChange={(e) => setAssignedAt(e.target.value)} />
            </div>
            <div>
              <Label className="mb-1 block text-sm font-medium" htmlFor="asg-role">Role</Label>
              <Input id="asg-role" value={role} onChange={(e) => setRole(e.target.value)} placeholder="MC, Talent, dst." />
            </div>
          </div>
          <div>
            <Label className="mb-1 block text-sm font-medium" htmlFor="asg-pic">PIC</Label>
            <Input id="asg-pic" value={pic} onChange={(e) => setPic(e.target.value)} placeholder="Nama PIC" />
          </div>
          <div>
            <Label className="mb-2 block text-sm font-medium">Rating Performa</Label>
            <div className="flex items-center gap-1">
              {[1, 2, 3, 4, 5].map((i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setRating(rating === i ? 0 : i)}
                  className="cursor-pointer"
                  aria-label={`Rating ${i}`}
                >
                  <Icons.exclusive
                    size={18}
                    className={i <= rating ? 'text-amber-500' : 'text-muted-foreground/30'}
                  />
                </button>
              ))}
            </div>
          </div>
          <div>
            <Label className="mb-1 block text-sm font-medium" htmlFor="asg-reco">Rekomendasi</Label>
            <select
              id="asg-reco"
              className="w-full rounded-xl border bg-background px-3 py-2 text-sm"
              value={recommendation}
              onChange={(e) => setRecommendation(e.target.value as Recommendation | '')}
            >
              <option value="">{'\u2014 Pilih \u2014'}</option>
              <option value="RECOMMENDED">Recommended</option>
              <option value="RECOMMENDED_NOTES">Recommended with Notes</option>
              <option value="NOT_RECOMMENDED">Not Recommended</option>
            </select>
          </div>
          <div>
            <Label className="mb-1 block text-sm font-medium" htmlFor="asg-notes">Catatan Performa</Label>
            <textarea
              id="asg-notes"
              className="w-full rounded-xl border bg-background px-3 py-2 text-sm"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Catatan performa (opsional)"
            />
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Batal</Button>
          <Button onClick={submit} disabled={saving}>
            {saving && <Icons.spinner className="mr-1" size={16} />}
            {edit ? 'Simpan' : 'Tambah'}
          </Button>
        </div>
      </div>
    </div>
  );
}

function ConfirmDialog({
  title,
  message,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
    >
      <div role="dialog" aria-label={title} className="w-full max-w-sm rounded-2xl border bg-background p-5 shadow-sm">
        <h3 className="mb-2 text-base font-semibold">{title}</h3>
        <p className="text-muted-foreground mb-4 text-sm">{message}</p>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onCancel}>Batal</Button>
          <Button variant="destructive" onClick={onConfirm}>{confirmLabel}</Button>
        </div>
      </div>
    </div>
  );
}

function EventRow({
  event,
  assignments,
  progress,
  freelancers,
  onEdit,
  onDelete,
}: {
  event: FreelanceEvent;
  assignments: EventAssignment[];
  progress: EventTaskProgress | null;
  freelancers: Freelancer[];
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [asgModal, setAsgModal] = useState(false);
  const [editAsg, setEditAsg] = useState<EventAssignment | null>(null);

  return (
    <Fragment key={event.id}>
      <TableRow className="cursor-pointer" onClick={() => setOpen(!open)}>
        <TableCell>
          <button
            type="button"
            aria-label={open ? 'Tutup detail' : 'Buka detail'}
            className="cursor-pointer"
            onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
          >
            {open ? <Icons.chevronUp size={16} /> : <Icons.chevronDown size={16} />}
          </button>
        </TableCell>
        <TableCell className="font-medium">{event.name}</TableCell>
        <TableCell>{fmtDate(event.event_date)}</TableCell>
        <TableCell>{event.client || '-'}</TableCell>
        <TableCell>{event.location || '-'}</TableCell>
        <TableCell className="text-center">{event.assignment_count}</TableCell>
        <TableCell className="min-w-[160px]">
          {progress ? (
            <div className="flex items-center gap-2">
              <Progress value={progress.percentage} />
              <span className="text-muted-foreground text-xs tabular-nums">{progress.percentage}%</span>
            </div>
          ) : (
            <span className="text-muted-foreground text-xs">{'\u2014'}</span>
          )}
        </TableCell>
        <TableCell className="text-right">
          <div className="flex justify-end gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => { e.stopPropagation(); onEdit(); }}
            >
              <Icons.adjustments size={14} /> Edit
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive"
              onClick={(e) => { e.stopPropagation(); onDelete(); }}
            >
              <Icons.close size={14} /> Hapus
            </Button>
          </div>
        </TableCell>
      </TableRow>
      {open && (
        <TableRow className="hover:bg-transparent">
          <TableCell colSpan={8}>
            <div className="space-y-4 bg-muted/30 rounded-xl p-4">
              {progress && progress.total > 0 && (
                <div className="flex flex-wrap gap-2">
                  <span className="text-muted-foreground mr-2 self-center text-xs font-medium uppercase tracking-wide">
                    Task:
                  </span>
                  <span className="text-sm font-medium">
                    {progress.total} total
                    {' \u00b7 '}
                  </span>
                  {STATUS_ORDER.map((s) => (
                    <Badge key={s} variant={STATUS_VARIANT[s]}>
                      {TASK_STATUS_LABELS[s]}: {progress[s]}
                    </Badge>
                  ))}
                </div>
              )}
              {event.description && (
                <p className="text-muted-foreground text-sm">{event.description}</p>
              )}
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Penugasan Freelancer ({assignments.length})
                </h4>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => { setEditAsg(null); setAsgModal(true); }}>
                    <Icons.add size={14} /> Tambah Penugasan
                  </Button>
                </div>
              </div>
              {assignments.length === 0 ? (
                <p className="text-muted-foreground text-sm">Belum ada freelancer yang ditugaskan.</p>
              ) : (
                <div className="overflow-hidden rounded-xl border">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-muted/50 text-left">
                        <th className="px-3 py-2 font-medium">Freelancer</th>
                        <th className="px-3 py-2 font-medium">Role</th>
                        <th className="px-3 py-2 font-medium">PIC</th>
                        <th className="px-3 py-2 font-medium">Tanggal</th>
                        <th className="px-3 py-2 font-medium">Rating</th>
                        <th className="px-3 py-2 font-medium">Rekomendasi</th>
                        <th className="px-3 py-2">
                          <span className="sr-only">Aksi</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {assignments.map((a) => (
                        <tr key={a.id} className="border-t">
                          <td className="px-3 py-2 font-medium">{a.freelancer_name}</td>
                          <td className="px-3 py-2">{a.role || '-'}</td>
                          <td className="px-3 py-2">{a.pic || '-'}</td>
                          <td className="px-3 py-2">{fmtDate(a.assigned_at)}</td>
                          <td className="px-3 py-2"><RatingStars rating={a.performance?.rating ?? null} /></td>
                          <td className="px-3 py-2">
                            {a.performance?.recommendation ? (
                              <Badge variant={a.performance.recommendation === 'NOT_RECOMMENDED' ? 'destructive' : 'secondary'}>
                                {RECOMMENDATION_LABELS[a.performance.recommendation] ?? a.performance.recommendation}
                              </Badge>
                            ) : '-'}
                          </td>
                          <td className="px-3 py-2 text-right">
                            <div className="flex justify-end gap-1">
                              <Button
                                size="sm"
                                variant="ghost"
                                aria-label="Edit penugasan"
                                onClick={() => { setEditAsg(a); setAsgModal(true); }}
                              >
                                <Icons.adjustments size={14} />
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="text-destructive"
                                aria-label="Hapus penugasan"
                                onClick={async () => {
                                  try {
                                    await deleteAssignment(a.id);
                                    toast.success('Penugasan dihapus.');
                                  } catch (err) {
                                    toast.error(err instanceof Error ? err.message : 'Gagal menghapus penugasan.');
                                  }
                                }}
                              >
                                <Icons.close size={14} />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <Link
                className="inline-flex items-center gap-1 text-sm font-medium text-primary underline-offset-4 hover:underline"
                href="/dashboard/task"
              >
                Lihat task &amp; progress detail <Icons.exclusive size={14} />
              </Link>
            </div>
          </TableCell>
        </TableRow>
      )}
      {asgModal && (
        <AssignmentModal
          onClose={() => setAsgModal(false)}
          event={event}
          edit={editAsg}
          freelancers={freelancers}
          onSaved={() => {
            setOpen(true);
            window.dispatchEvent(new CustomEvent('event-page-reload'));
          }}
        />
      )}
    </Fragment>
  );
}

export default function EventPage() {
  const [events, setEvents] = useState<FreelanceEvent[]>([]);
  const [freelancers, setFreelancers] = useState<Freelancer[]>([]);
  const [assignments, setAssignments] = useState<Record<number, EventAssignment[]>>({});
  const [progressMap, setProgressMap] = useState<Record<number, EventTaskProgress | null>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editEvent, setEditEvent] = useState<FreelanceEvent | null>(null);
  const [confirmEvent, setConfirmEvent] = useState<FreelanceEvent | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listEvents(search ? { search } : {});
      setEvents(data);
      const asgResults = await Promise.all(
        data.map((ev) => listAssignments({ event: String(ev.id) }).catch(() => [] as EventAssignment[])),
      );
      const asgMap: Record<number, EventAssignment[]> = {};
      data.forEach((ev, i) => { asgMap[ev.id] = asgResults[i]; });
      setAssignments(asgMap);
      const progResults = await Promise.all(
        data.map((ev) => getEventTaskProgress(ev.id).catch(() => null)),
      );
      const progMap: Record<number, EventTaskProgress | null> = {};
      data.forEach((ev, i) => { progMap[ev.id] = progResults[i]; });
      setProgressMap(progMap);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal memuat data.');
    } finally {
      setLoading(false);
    }
  }, [search]);

  // eslint-disable-next-line react/set-state-in-effect -- data fetch on filter change
  useEffect(() => {
    load();
  }, [load]);

  // eslint-disable-next-line react/set-state-in-effect -- initial data fetch
  useEffect(() => {
    listFreelancers().then(setFreelancers).catch(() => {});
    const reload = () => load();
    window.addEventListener('event-page-reload', reload);
    return () => window.removeEventListener('event-page-reload', reload);
  }, [load]);

  async function handleDelete() {
    if (!confirmEvent) return;
    try {
      await deleteEvent(confirmEvent.id);
      toast.success('Event dihapus.');
      setConfirmEvent(null);
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal menghapus event.');
    }
  }

  const filtered = events.filter((ev) => {
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    return (
      ev.name.toLowerCase().includes(q) ||
      ev.client.toLowerCase().includes(q) ||
      ev.location.toLowerCase().includes(q)
    );
  });

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Event Management</h2>
          <p className="text-muted-foreground text-sm">
            Kelola event, penugasan freelancer, dan pantau progres.
          </p>
        </div>
        <Button
          onClick={() => {
            setEditEvent(null);
            setModalOpen(true);
          }}
        >
          <Icons.add className="mr-1" size={16} /> Tambah Event
        </Button>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[240px]">
          <Label className="mb-1 block text-xs" htmlFor="event-search">Cari</Label>
          <Input
            id="event-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari nama, klien, lokasi..."
          />
        </div>
        {search && (
          <Button variant="outline" onClick={() => setSearch('')}>Reset</Button>
        )}
      </div>

      <Card>
        <CardContent>
          {loading ? (
            <div className="space-y-2 py-4">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-12 text-center">
              <p className="font-medium">Belum ada event</p>
              <p className="text-muted-foreground text-sm">Buat event pertama untuk mulai staffing.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10" />
                  <TableHead>Nama</TableHead>
                  <TableHead>Tanggal</TableHead>
                  <TableHead>Klien</TableHead>
                  <TableHead>Lokasi</TableHead>
                  <TableHead className="text-center">Penugasan</TableHead>
                  <TableHead>Progress</TableHead>
                  <TableHead className="text-right">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((ev) => (
                  <EventRow
                    key={ev.id}
                    event={ev}
                    assignments={assignments[ev.id] ?? []}
                    progress={progressMap[ev.id] ?? null}
                    freelancers={freelancers}
                    onEdit={() => {
                      setEditEvent(ev);
                      setModalOpen(true);
                    }}
                    onDelete={() => setConfirmEvent(ev)}
                  />
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {modalOpen && (
        <EventModal
          onClose={() => setModalOpen(false)}
          edit={editEvent}
          onSaved={load}
        />
      )}

      {confirmEvent && (
        <ConfirmDialog
          title="Hapus Event"
          message={`Hapus "${confirmEvent.name}"? Penugasan dan task terkait ikut terhapus.`}
          confirmLabel="Hapus"
          onConfirm={handleDelete}
          onCancel={() => setConfirmEvent(null)}
        />
      )}
    </div>
  );
}
