'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
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
  TASK_STATUS_LABELS,
  addTaskUpdate,
  createTask,
  deleteTask,
  getEventTaskProgress,
  listEvents,
  listFreelancers,
  listTasks,
  request,
  updateTask,
  type EventTaskProgress,
  type FreelanceEvent,
  type FreelanceTask,
  type Freelancer,
  type TaskStatus,
  type TaskUpdate,
} from '@/lib/freelance';

const STATUS_VARIANT: Record<TaskStatus, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  BELUM_MULAI: 'outline',
  SEDANG_DIKERJAKAN: 'secondary',
  SELESAI: 'default',
  TERKENDALA: 'destructive',
};

function fmtDate(d: string | null): string {
  if (!d) return '-';
  return new Date(d).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
}

function fmtDateTime(d: string): string {
  return new Date(d).toLocaleString('id-ID', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function StatusBadge({ status }: { status: TaskStatus }) {
  return <Badge variant={STATUS_VARIANT[status]}>{TASK_STATUS_LABELS[status]}</Badge>;
}

function TaskFormModal({
  open,
  onClose,
  events,
  freelancers,
  edit,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  events: FreelanceEvent[];
  freelancers: Freelancer[];
  edit: FreelanceTask | null;
  onSaved: () => void;
}) {
  const [eventId, setEventId] = useState<number | ''>(edit?.event ?? '');
  const [freelancerId, setFreelancerId] = useState<number | ''>(edit?.freelancer ?? '');
  const [title, setTitle] = useState(edit?.title ?? '');
  const [description, setDescription] = useState(edit?.description ?? '');
  const [deadline, setDeadline] = useState(edit?.deadline ?? '');
  const [status, setStatus] = useState<TaskStatus>(edit?.status ?? 'BELUM_MULAI');
  const [pic, setPic] = useState(edit?.pic_name ?? '');
  const [saving, setSaving] = useState(false);

  // eslint-disable-next-line react/set-state-in-effect -- sync form state when modal opens
  useEffect(() => {
    if (open) {
      setEventId(edit?.event ?? '');
      setFreelancerId(edit?.freelancer ?? '');
      setTitle(edit?.title ?? '');
      setDescription(edit?.description ?? '');
      setDeadline(edit?.deadline ?? '');
      setStatus(edit?.status ?? 'BELUM_MULAI');
      setPic(edit?.pic_name ?? '');
    }
  }, [open, edit]);

  if (!open) return null;

  const submit = async () => {
    if (!eventId) {
      toast.error('Pilih event.');
      return;
    }
    if (!freelancerId) {
      toast.error('Pilih freelancer.');
      return;
    }
    if (!title.trim()) {
      toast.error('Judul task wajib diisi.');
      return;
    }
    setSaving(true);
    try {
      const input = {
        event: eventId as number,
        freelancer: freelancerId as number,
        title: title.trim(),
        description: description || undefined,
        deadline: deadline || null,
        status,
        pic: pic || undefined,
      };
      if (edit) {
        await updateTask(edit.id, input);
        toast.success('Task diperbarui.');
      } else {
        await createTask(input);
        toast.success('Task dibuat.');
      }
      onSaved();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal simpan.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <button
      type='button'
      aria-label='Tutup'
      className='fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm'
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div role='dialog' aria-modal='true' className='w-full max-w-lg rounded-2xl border bg-background p-5 shadow-lg'>
        <div className='mb-4 flex items-center justify-between'>
          <h3 className='text-base font-semibold'>{edit ? 'Edit Task' : 'Tambah Task'}</h3>
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
          <div className='grid grid-cols-2 gap-3'>
            <div>
              <label htmlFor='task-event' className='mb-1 block text-sm font-medium'>Event *</label>
              <select
                id='task-event'
                className='border-input h-9 w-full rounded-lg border bg-transparent px-2.5 text-sm'
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
              <label htmlFor='task-freelancer' className='mb-1 block text-sm font-medium'>Freelancer *</label>
              <select
                id='task-freelancer'
                className='border-input h-9 w-full rounded-lg border bg-transparent px-2.5 text-sm'
                value={freelancerId}
                onChange={(e) => setFreelancerId(e.target.value ? Number(e.target.value) : '')}
              >
                <option value=''>— Pilih freelancer —</option>
                {freelancers.map((f) => (
                  <option key={f.id} value={f.id}>{f.full_name}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label htmlFor='task-title' className='mb-1 block text-sm font-medium'>Judul Task *</label>
            <Input id='task-title' value={title} onChange={(e) => setTitle(e.target.value)} placeholder='Contoh: Setup booth utama' />
          </div>
          <div>
            <label htmlFor='task-description' className='mb-1 block text-sm font-medium'>Deskripsi / Catatan</label>
            <textarea
              id='task-description'
              className='w-full rounded-xl border bg-background px-3 py-2 text-sm'
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className='grid grid-cols-3 gap-3'>
            <div>
              <label htmlFor='task-deadline' className='mb-1 block text-sm font-medium'>Deadline</label>
              <Input id='task-deadline' type='date' value={deadline} onChange={(e) => setDeadline(e.target.value)} />
            </div>
            <div>
              <label htmlFor='task-status' className='mb-1 block text-sm font-medium'>Status</label>
              <select
                id='task-status'
                className='border-input h-9 w-full rounded-lg border bg-transparent px-2.5 text-sm'
                value={status}
                onChange={(e) => setStatus(e.target.value as TaskStatus)}
              >
                {Object.entries(TASK_STATUS_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor='task-pic' className='mb-1 block text-sm font-medium'>PIC</label>
              <Input id='task-pic' value={pic} onChange={(e) => setPic(e.target.value)} placeholder='Nama PIC' />
            </div>
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
    </button>
  );
}

function TaskDetailView({
  task,
  onClose,
  onChanged,
}: {
  task: FreelanceTask;
  onClose: () => void;
  onChanged: (t: FreelanceTask) => void;
}) {
  const [updates, setUpdates] = useState<TaskUpdate[]>([]);
  const [note, setNote] = useState('');
  const [newStatus, setNewStatus] = useState<TaskStatus>(task.status);
  const [saving, setSaving] = useState(false);

  // eslint-disable-next-line react/set-state-in-effect -- reset + fetch on task switch
  useEffect(() => {
    setUpdates([]);
    setNote('');
    setNewStatus(task.status);
    let alive = true;
    request<TaskUpdate[]>(`/tasks/${task.id}/updates/`)
      .then((data) => { if (alive) setUpdates(data); })
      .catch(() => {});
    return () => { alive = false; };
  }, [task.id]);

  const submitUpdate = async () => {
    if (!note.trim() && newStatus === task.status) {
      toast.error('Isi catatan atau ubah status.');
      return;
    }
    setSaving(true);
    try {
      await addTaskUpdate(task.id, { status: newStatus, note: note.trim() });
      toast.success('Update tersimpan.');
      setNote('');
      onChanged({ ...task, status: newStatus });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal simpan.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className='space-y-4'>
      <div className='flex items-start justify-between gap-2'>
        <div>
          <h3 className='text-lg font-semibold'>{task.title}</h3>
          <p className='text-muted-foreground text-sm'>
            {task.event_name} · {task.freelancer_name}
          </p>
        </div>
        <Button size='sm' variant='ghost' onClick={onClose} aria-label='Tutup detail'>
          <Icons.close size={16} />
        </Button>
      </div>
      <div className='grid gap-3 md:grid-cols-4'>
        <div className='rounded-xl border p-3'>
          <p className='text-muted-foreground text-xs'>Deadline</p>
          <p className='font-medium'>{fmtDate(task.deadline)}</p>
        </div>
        <div className='rounded-xl border p-3'>
          <p className='text-muted-foreground text-xs'>PIC</p>
          <p className='font-medium'>{task.pic_name || '-'}</p>
        </div>
        <div className='rounded-xl border p-3'>
          <p className='text-muted-foreground text-xs'>Status</p>
          <div className='mt-1'><StatusBadge status={task.status} /></div>
        </div>
        <div className='rounded-xl border p-3'>
          <p className='text-muted-foreground text-xs'>Update terakhir</p>
          <p className='font-medium'>{task.last_update ? fmtDateTime(task.last_update.created_at) : '-'}</p>
        </div>
      </div>
      {task.description && (
        <div className='rounded-xl border p-3'>
          <p className='text-muted-foreground text-xs'>Deskripsi / Catatan</p>
          <p className='mt-1 text-sm'>{task.description}</p>
        </div>
      )}
      <div className='rounded-xl border p-3'>
        <p className='mb-2 text-sm font-medium'>Riwayat Update</p>
        {updates.length === 0 ? (
          <p className='text-muted-foreground text-sm'>Belum ada update.</p>
        ) : (
          <ol className='space-y-2'>
            {updates.map((u) => (
              <li key={u.id} className='flex flex-wrap gap-3 text-sm'>
                <span className='text-muted-foreground w-40 shrink-0'>{fmtDateTime(u.created_at)}</span>
                <span className='w-40 shrink-0'><StatusBadge status={u.status} /></span>
                <span className='flex-1'>
                  {u.note || <span className='text-muted-foreground'>-</span>}
                  {u.created_by_name && (
                    <span className='text-muted-foreground ml-2 text-xs'>— {u.created_by_name}</span>
                  )}
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>
      <div className='rounded-xl border p-3'>
        <p className='mb-2 text-sm font-medium'>Tambah Update</p>
        <div className='flex flex-wrap items-end gap-2'>
          <div>
            <Label className='text-xs'>Status baru</Label>
            <select
              className='border-input h-9 rounded-lg border bg-transparent px-2.5 text-sm'
              value={newStatus}
              onChange={(e) => setNewStatus(e.target.value as TaskStatus)}
            >
              {Object.entries(TASK_STATUS_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>
          <div className='min-w-[200px] flex-1'>
            <Label className='text-xs'>Catatan</Label>
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder='Catatan progress (opsional)' />
          </div>
          <Button onClick={submitUpdate} disabled={saving}>
            {saving ? <Icons.spinner className='mr-1 animate-spin' size={16} /> : null}
            Kirim
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function TaskPage() {
  const [items, setItems] = useState<FreelanceTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [fEvent, setFEvent] = useState('');
  const [fFreelancer, setFFreelancer] = useState('');
  const [fStatus, setFStatus] = useState('');
  const [fDeadline, setFDeadline] = useState('');
  const [events, setEvents] = useState<FreelanceEvent[]>([]);
  const [freelancers, setFreelancers] = useState<Freelancer[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editTask, setEditTask] = useState<FreelanceTask | null>(null);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [detail, setDetail] = useState<FreelanceTask | null>(null);
  const [progress, setProgress] = useState<EventTaskProgress | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const params: Record<string, string> = {};
    if (search) params.search = search;
    if (fEvent) params.event = fEvent;
    if (fFreelancer) params.freelancer = fFreelancer;
    if (fStatus) params.status = fStatus;
    if (fDeadline) params.deadline_before = fDeadline;
    try {
      const data = await listTasks(params);
      setItems(data);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal memuat data.');
    } finally {
      setLoading(false);
    }
  }, [search, fEvent, fFreelancer, fStatus, fDeadline]);

  // eslint-disable-next-line react/set-state-in-effect -- data fetch on filter change
  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    listEvents().then(setEvents).catch(() => {});
    listFreelancers().then(setFreelancers).catch(() => {});
    // eslint-disable-next-line react/set-state-in-effect -- initial data fetch
  }, []);

  // Event progress card: reload when filter changes or after task mutations (items dep).
  // eslint-disable-next-line react/set-state-in-effect -- progress fetch tied to list reload
  useEffect(() => {
    if (!fEvent) {
      setProgress(null);
      return;
    }
    getEventTaskProgress(Number(fEvent))
      .then(setProgress)
      .catch(() => setProgress(null));
  }, [fEvent, items]);

  function openDetail(task: FreelanceTask) {
    if (detailId === task.id) {
      setDetailId(null);
      setDetail(null);
      return;
    }
    setDetailId(task.id);
    setDetail(task);
  }

  function resetFilters() {
    setSearch('');
    setFEvent('');
    setFFreelancer('');
    setFStatus('');
    setFDeadline('');
  }

  return (
    <div className='flex flex-1 flex-col gap-4 p-4 md:p-6'>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <div>
          <h2 className='text-2xl font-bold tracking-tight'>Freelance Task &amp; Progress</h2>
          <p className='text-muted-foreground text-sm'>
            Kelola task freelancer per event dan pantau progres.
          </p>
        </div>
        <Button onClick={() => { setEditTask(null); setModalOpen(true); }}>
          <Icons.add className='mr-1' size={16} /> Tambah Task
        </Button>
      </div>

      {progress && (
        <Card>
          <CardHeader>
            <CardTitle>Progress Event</CardTitle>
          </CardHeader>
          <CardContent>
            <div className='flex items-center gap-4'>
              <div className='flex-1'>
                <Progress value={progress.percentage} />
              </div>
              <div className='text-2xl font-bold'>{progress.percentage}%</div>
            </div>
            <div className='mt-3 grid grid-cols-2 gap-2 md:grid-cols-5'>
              <div className='rounded-xl border p-2 text-center'>
                <p className='text-muted-foreground text-xs'>Total</p>
                <p className='text-lg font-semibold'>{progress.total}</p>
              </div>
              {(['BELUM_MULAI', 'SEDANG_DIKERJAKAN', 'SELESAI', 'TERKENDALA'] as TaskStatus[]).map((s) => (
                <div key={s} className='rounded-xl border p-2 text-center'>
                  <p className='text-muted-foreground text-xs'>{TASK_STATUS_LABELS[s]}</p>
                  <p className='text-lg font-semibold'>{progress[s]}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Filter</CardTitle>
        </CardHeader>
        <CardContent>
          <div className='grid grid-cols-1 gap-3 md:grid-cols-3 lg:grid-cols-6'>
            <div className='lg:col-span-2'>
              <Label className='text-xs'>Cari</Label>
              <Input
                placeholder='Judul, deskripsi, PIC...'
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div>
              <Label className='text-xs'>Event</Label>
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
            <div>
              <Label className='text-xs'>Freelancer</Label>
              <select
                className='border-input h-9 w-full rounded-lg border bg-transparent px-2.5 text-sm'
                value={fFreelancer}
                onChange={(e) => setFFreelancer(e.target.value)}
              >
                <option value=''>Semua</option>
                {freelancers.map((f) => (
                  <option key={f.id} value={f.id}>{f.full_name}</option>
                ))}
              </select>
            </div>
            <div>
              <Label className='text-xs'>Status</Label>
              <select
                className='border-input h-9 w-full rounded-lg border bg-transparent px-2.5 text-sm'
                value={fStatus}
                onChange={(e) => setFStatus(e.target.value)}
              >
                <option value=''>Semua</option>
                {Object.entries(TASK_STATUS_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>
            <div>
              <Label className='text-xs'>Deadline sebelum</Label>
              <Input type='date' value={fDeadline} onChange={(e) => setFDeadline(e.target.value)} />
            </div>
            <div className='flex items-end'>
              <Button variant='ghost' onClick={resetFilters}>Reset</Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Daftar Task ({items.length})</CardTitle>
        </CardHeader>
        <CardContent className='p-0'>
          {loading && items.length === 0 ? (
            <div className='space-y-2 p-6'>
              <Skeleton className='h-8 w-full' />
              <Skeleton className='h-8 w-full' />
              <Skeleton className='h-8 w-full' />
            </div>
          ) : items.length === 0 ? (
            <div className='p-6 text-center'>
              <Icons.task size={32} className='mx-auto mb-2 text-muted-foreground' />
              <p className='font-medium'>Belum ada task</p>
              <p className='text-muted-foreground text-sm'>Buat task pertama untuk event Anda.</p>
            </div>
          ) : (
            <div className='overflow-x-auto'>
              <table className='w-full text-sm'>
                <TableHeader>
                  <TableRow>
                    <TableHead>Event</TableHead>
                    <TableHead>Freelancer</TableHead>
                    <TableHead>Task</TableHead>
                    <TableHead>Deadline</TableHead>
                    <TableHead>PIC</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Last update</TableHead>
                    <TableHead className='text-right'>Aksi</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((t) => (
                    <Fragment key={t.id}>
                      <TableRow>
                        <TableCell className='font-medium'>{t.event_name}</TableCell>
                        <TableCell>{t.freelancer_name}</TableCell>
                        <TableCell className='font-medium'>
                          <button className='text-left hover:underline' onClick={() => openDetail(t)}>
                            {t.title}
                          </button>
                        </TableCell>
                        <TableCell>{fmtDate(t.deadline)}</TableCell>
                        <TableCell>{t.pic_name || '-'}</TableCell>
                        <TableCell><StatusBadge status={t.status} /></TableCell>
                        <TableCell>
                          {t.last_update
                            ? `${fmtDateTime(t.last_update.created_at)}${t.last_update.created_by_name ? ` — ${t.last_update.created_by_name}` : ''}`
                            : '-'}
                        </TableCell>
                        <TableCell className='text-right'>
                          <div className='flex justify-end gap-1'>
                            <Button size='sm' variant='ghost' onClick={() => openDetail(t)}>Detail</Button>
                            <Button size='sm' variant='ghost' onClick={() => { setEditTask(t); setModalOpen(true); }}>
                              <Icons.edit size={14} />
                            </Button>
                            <Button
                              size='sm'
                              variant='destructive'
                              onClick={async () => {
                                if (!window.confirm(`Hapus task "${t.title}"?`)) return;
                                try {
                                  await deleteTask(t.id);
                                  toast.success('Dihapus.');
                                  await load();
                                } catch (err) {
                                  toast.error(err instanceof Error ? err.message : 'Gagal menghapus.');
                                }
                              }}
                            >
                              <Icons.trash size={14} />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                      {detailId === t.id && (
                        <TableRow className='hover:bg-transparent'>
                          <TableCell colSpan={8} className='p-0'>
                            <div className='border-t bg-muted/30 p-4 md:p-6'>
                              <TaskDetailView
                                task={detail?.id === t.id ? detail : t}
                                onClose={() => { setDetailId(null); setDetail(null); }}
                                onChanged={(updated) => {
                                  setDetail(updated);
                                  setItems((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
                                  void load();
                                }}
                              />
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

      <TaskFormModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        events={events}
        freelancers={freelancers}
        edit={editTask}
        onSaved={async () => { await load(); }}
      />
    </div>
  );
}
