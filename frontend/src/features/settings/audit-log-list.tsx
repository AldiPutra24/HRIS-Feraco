'use client';

import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Icons } from '@/components/icons';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { SoftHardDeleteMenu } from '@/components/soft-hard-delete-menu';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  AUDIT_ACTIONS,
  auditActionLabel,
  clearAllAuditLogs,
  deleteAuditLog,
  listAuditActions,
  listAuditLogs,
  type AuditEntry
} from '@/lib/audit';
import { useAuth } from '@/lib/auth/auth-provider';

function fmtTime(ts: string) {
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? ts : d.toLocaleString();
}

function ActionBadge({ action }: { action: string }) {
  const key = action.toLowerCase();
  const tone =
    key === 'delete'
      ? 'destructive'
      : key === 'approve' || key === 'activate'
        ? 'default'
        : key === 'reject' || key === 'terminate'
          ? 'secondary'
          : 'outline';
  return <Badge variant={tone as 'destructive'}>{auditActionLabel(action)}</Badge>;
}

type Filters = { actor: string; action: string; module: string; dateFrom: string; dateTo: string };

const EMPTY_FILTERS: Filters = { actor: '', action: '', module: '', dateFrom: '', dateTo: '' };
const PAGE_SIZE = 20;

function changedCount(e: AuditEntry) {
  return Object.keys(e.changes_before).length + Object.keys(e.changes_after).length;
}

export function AuditLogList() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actions, setActions] = useState<string[]>(AUDIT_ACTIONS);
  // `draft` = form inputs; `applied` = filters used for the current list.
  const [draft, setDraft] = useState<Filters>(EMPTY_FILTERS);
  const [applied, setApplied] = useState<Filters>(EMPTY_FILTERS);
  const [selected, setSelected] = useState<AuditEntry | null>(null);

  const totalPages = Math.max(1, Math.ceil(count / PAGE_SIZE));

  async function load(filters: Filters = applied, targetPage: number = page) {
    setLoading(true);
    setError('');
    try {
      const data = await listAuditLogs({
        actor: filters.actor.trim() || undefined,
        action: filters.action || undefined,
        module: filters.module.trim() || undefined,
        date_from: filters.dateFrom || undefined,
        date_to: filters.dateTo || undefined,
        page: targetPage > 1 ? String(targetPage) : undefined
      });
      setEntries(data.results);
      setCount(data.count);
      setPage(targetPage);
      setSelected(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat audit log.');
    } finally {
      setLoading(false);
    }
  }

  function apply() {
    if (draft.dateFrom && draft.dateTo && draft.dateFrom > draft.dateTo) {
      setError('Tanggal "Sampai" tidak boleh sebelum tanggal "Dari".');
      return;
    }
    setApplied(draft);
    load(draft, 1);
  }

  function reset() {
    setDraft(EMPTY_FILTERS);
    setApplied(EMPTY_FILTERS);
    load(EMPTY_FILTERS, 1);
  }

  function setField(field: keyof Filters, value: string) {
    setDraft((d) => ({ ...d, [field]: value }));
  }

  async function onDelete(id: number, hard = false) {
    if (!window.confirm(hard ? 'Hapus permanen log ini?' : 'Hapus log ini?')) return;
    try {
      await deleteAuditLog(id, hard);
      // Stay on the page unless it just became empty.
      load(applied, entries.length === 1 && page > 1 ? page - 1 : page);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menghapus log.');
    }
  }

  async function onClearAll() {
    if (!window.confirm('Hapus SEMUA audit log secara permanen?')) return;
    try {
      await clearAllAuditLogs();
      load(applied, 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menghapus log.');
    }
  }

  useEffect(() => {
    load(EMPTY_FILTERS, 1);
    listAuditActions()
      .then((list) => {
        if (list.length) setActions(list);
      })
      .catch(() => {
        // Keep the static fallback list.
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className='flex flex-1 flex-col gap-4 p-4 md:p-6'>
      <div>
        <h2 className='text-2xl font-bold tracking-tight'>Audit Log</h2>
        <p className='text-muted-foreground text-sm'>Jejak aktivitas penting pada sistem.</p>
        {isAdmin && (
          <div className='mt-2'>
            <Button variant='destructive' size='sm' onClick={onClearAll}>
              <Icons.trash />
              Hapus Semua
            </Button>
          </div>
        )}
      </div>

      <Card>
        <CardContent className='p-4'>
          <form
            className='flex flex-wrap items-end gap-2'
            onSubmit={(ev) => {
              ev.preventDefault();
              apply();
            }}
          >
            <div className='flex flex-col gap-1'>
              <label htmlFor='audit-actor' className='text-muted-foreground text-xs'>Actor</label>
              <Input id='audit-actor' value={draft.actor} onChange={(e) => setField('actor', e.target.value)} placeholder='username' className='h-8 w-40' />
            </div>
            <div className='flex flex-col gap-1'>
              <label htmlFor='audit-action' className='text-muted-foreground text-xs'>Action</label>
              <select
                id='audit-action'
                className='border-input h-8 rounded-lg border bg-transparent px-2.5 text-sm'
                value={draft.action}
                onChange={(e) => setField('action', e.target.value)}
              >
                <option value=''>Semua</option>
                {actions.map((a) => (
                  <option key={a} value={a}>{auditActionLabel(a)}</option>
                ))}
              </select>
            </div>
            <div className='flex flex-col gap-1'>
              <label htmlFor='audit-module' className='text-muted-foreground text-xs'>Module</label>
              <Input id='audit-module' value={draft.module} onChange={(e) => setField('module', e.target.value)} placeholder='personnel/leaves' className='h-8 w-40' />
            </div>
            <div className='flex flex-col gap-1'>
              <label htmlFor='audit-from' className='text-muted-foreground text-xs'>Dari</label>
              <Input
                id='audit-from'
                type='date'
                value={draft.dateFrom}
                max={draft.dateTo || undefined}
                onChange={(e) => setField('dateFrom', e.target.value)}
                className='h-8'
              />
            </div>
            <div className='flex flex-col gap-1'>
              <label htmlFor='audit-to' className='text-muted-foreground text-xs'>Sampai</label>
              <Input
                id='audit-to'
                type='date'
                value={draft.dateTo}
                min={draft.dateFrom || undefined}
                onChange={(e) => setField('dateTo', e.target.value)}
                className='h-8'
              />
            </div>
            <Button size='sm' type='submit' disabled={loading}>Terapkan</Button>
            <Button size='sm' type='button' variant='ghost' onClick={reset} disabled={loading}>Reset</Button>
          </form>
        </CardContent>
      </Card>

      {error && <p className='text-destructive text-sm'>{error}</p>}

      <Card>
        <CardContent className='p-0'>
          {loading ? (
            <div className='space-y-2 p-4'>
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className='h-8 w-full' />
              ))}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>Actor</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Module</TableHead>
                  <TableHead>Object</TableHead>
                  <TableHead>Detail</TableHead>
                  {isAdmin && <TableHead className='text-right'>Aksi</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((e) => (
                  <TableRow key={e.id} className='cursor-pointer' onClick={() => setSelected(selected?.id === e.id ? null : e)}>
                    <TableCell className='whitespace-nowrap'>{fmtTime(e.timestamp)}</TableCell>
                    <TableCell>{e.actor || '-'}</TableCell>
                    <TableCell><ActionBadge action={e.action} /></TableCell>
                    <TableCell>{e.module || '-'}</TableCell>
                    <TableCell className='max-w-40 truncate'>{e.object_repr || e.entity_type || '-'}</TableCell>
                    <TableCell className='max-w-56 truncate'>{e.description || (changedCount(e) > 0 ? `${changedCount(e)} field berubah` : '-')}</TableCell>
                    {isAdmin && (
                      <TableCell className='text-right' onClick={(ev) => ev.stopPropagation()}>
                        <SoftHardDeleteMenu
                          label=''
                          onSoft={() => onDelete(e.id)}
                          onHard={() => onDelete(e.id, true)}
                        />
                      </TableCell>
                    )}
                  </TableRow>
                ))}
                {entries.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={isAdmin ? 7 : 6} className='text-muted-foreground py-8 text-center'>
                      Tidak ada aktivitas yang cocok.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
          <div className='flex items-center justify-between gap-2 border-t px-4 py-2 text-sm'>
            <span className='text-muted-foreground'>
              {count === 0
                ? '0 data'
                : `${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, count)} dari ${count} data`}
            </span>
            <div className='flex items-center gap-2'>
              <Button size='sm' variant='outline' disabled={loading || page <= 1} onClick={() => load(applied, page - 1)}>
                Sebelumnya
              </Button>
              <span className='text-muted-foreground'>
                {page} / {totalPages}
              </span>
              <Button
                size='sm'
                variant='outline'
                disabled={loading || page >= totalPages}
                onClick={() => load(applied, page + 1)}
              >
                Berikutnya
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {selected && (
        <Card>
          <CardContent className='space-y-3 p-4'>
            <div className='flex items-center justify-between'>
              <h3 className='font-semibold'>Detail Perubahan</h3>
              <Button variant='ghost' size='sm' onClick={() => setSelected(null)}>Tutup</Button>
            </div>
            <p className='text-muted-foreground text-sm'>{selected.description || selected.action}</p>
            {changedCount(selected) > 0 ? (
              <div className='grid grid-cols-1 gap-4 md:grid-cols-2'>
                <div>
                  <p className='mb-1 text-xs font-medium'>Before</p>
                  <pre className='bg-muted overflow-auto rounded-lg p-2 text-xs'>{JSON.stringify(selected.changes_before, null, 2)}</pre>
                </div>
                <div>
                  <p className='mb-1 text-xs font-medium'>After</p>
                  <pre className='bg-muted overflow-auto rounded-lg p-2 text-xs'>{JSON.stringify(selected.changes_after, null, 2)}</pre>
                </div>
              </div>
            ) : (
              <p className='text-muted-foreground text-sm'>Tidak ada perubahan field yang tercatat.</p>
            )}
            <p className='text-muted-foreground text-xs'>
              IP: {selected.ip_address || '-'} · UA: {selected.user_agent || '-'}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
