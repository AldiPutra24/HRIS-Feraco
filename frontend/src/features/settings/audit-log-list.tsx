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
import { clearAllAuditLogs, deleteAuditLog, AUDIT_ACTIONS, listAuditLogs, type AuditEntry } from '@/lib/audit';
import { useAuth } from '@/lib/auth/auth-provider';

function fmtTime(ts: string) {
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? ts : d.toLocaleString();
}

function ActionBadge({ action }: { action: string }) {
  const tone =
    action === 'DELETE'
      ? 'destructive'
      : action === 'APPROVE' || action === 'ACTIVATE'
        ? 'default'
        : action === 'REJECT' || action === 'TERMINATE'
          ? 'secondary'
          : 'outline';
  return <Badge variant={tone as 'destructive'}>{action}</Badge>;
}

function changedCount(e: AuditEntry) {
  return Object.keys(e.changes_before).length + Object.keys(e.changes_after).length;
}

export function AuditLogList() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actor, setActor] = useState('');
  const [action, setAction] = useState('');
  const [module, setModule] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [selected, setSelected] = useState<AuditEntry | null>(null);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const data = await listAuditLogs({
        actor: actor || undefined,
        action: action || undefined,
        module: module || undefined,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined
      });
      setEntries(data.results);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat audit log.');
    } finally {
      setLoading(false);
    }
  }

  async function onDelete(id: number, hard = false) {
    if (!window.confirm(hard ? 'Hapus permanen log ini?' : 'Hapus log ini?')) return;
    try {
      await deleteAuditLog(id, hard);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menghapus log.');
    }
  }

  async function onClearAll() {
    if (!window.confirm('Hapus SEMUA audit log secara permanen?')) return;
    try {
      await clearAllAuditLogs();
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menghapus log.');
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function reset() {
    setActor('');
    setAction('');
    setModule('');
    setDateFrom('');
    setDateTo('');
  }

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
        <CardContent className='flex flex-wrap items-end gap-2 p-4'>
          <div className='flex flex-col gap-1'>
            <label htmlFor='audit-actor' className='text-muted-foreground text-xs'>Actor</label>
            <Input id='audit-actor' value={actor} onChange={(e) => setActor(e.target.value)} placeholder='username' className='h-8 w-40' />
          </div>
          <div className='flex flex-col gap-1'>
            <label htmlFor='audit-action' className='text-muted-foreground text-xs'>Action</label>
            <select id='audit-action' className='border-input h-8 rounded-lg border bg-transparent px-2.5 text-sm' value={action} onChange={(e) => setAction(e.target.value)}>
              <option value=''>Semua</option>
              {AUDIT_ACTIONS.map((a) => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
          </div>
          <div className='flex flex-col gap-1'>
            <label htmlFor='audit-module' className='text-muted-foreground text-xs'>Module</label>
            <Input id='audit-module' value={module} onChange={(e) => setModule(e.target.value)} placeholder='personnel/leaves' className='h-8 w-40' />
          </div>
          <div className='flex flex-col gap-1'>
            <label htmlFor='audit-from' className='text-muted-foreground text-xs'>Dari</label>
            <Input id='audit-from' type='date' value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className='h-8' />
          </div>
          <div className='flex flex-col gap-1'>
            <label htmlFor='audit-to' className='text-muted-foreground text-xs'>Sampai</label>
            <Input id='audit-to' type='date' value={dateTo} onChange={(e) => setDateTo(e.target.value)} className='h-8' />
          </div>
          <Button size='sm' onClick={load}>Terapkan</Button>
          <Button size='sm' variant='ghost' onClick={reset}>Reset</Button>
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
