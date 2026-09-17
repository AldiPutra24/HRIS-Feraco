'use client';

import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Icons } from '@/components/icons';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useAuth } from '@/lib/auth/auth-provider';
import {
  DELIVERY_CHANNEL_LABELS,
  DELIVERY_EVENT_LABELS,
  DELIVERY_STATUS_LABELS,
  getDeliverySummary,
  listDeliveryLogs,
  type DeliveryChannel,
  type DeliveryLog,
  type DeliveryStatus,
  type DeliverySummary,
} from '@/lib/notifications';

const HR_ROLES = ['admin', 'hr_staff', 'hr_lead'];
const PAGE_SIZE = 20;
const EVENT_OPTIONS = ['LEAVE_SUBMITTED', 'LEAVE_APPROVED', 'LEAVE_REJECTED', 'CONTRACT', 'BIRTHDAY'];

const SELECT_CLASS = 'border-input h-8 rounded-lg border bg-transparent px-2.5 text-sm';

function fmtTime(ts: string) {
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? ts : d.toLocaleString();
}

function StatusBadge({ status }: { status: DeliveryStatus }) {
  const variant = status === 'FAILED' ? 'destructive' : status === 'SENT' ? 'default' : 'secondary';
  return <Badge variant={variant}>{DELIVERY_STATUS_LABELS[status] ?? status}</Badge>;
}

function ChannelBadge({ channel }: { channel: DeliveryChannel }) {
  return <Badge variant='outline'>{DELIVERY_CHANNEL_LABELS[channel] ?? channel}</Badge>;
}

function SummaryCard({ label, value, destructive }: { label: string; value: number; destructive?: boolean }) {
  return (
    <Card>
      <CardContent className='p-4'>
        <p className='text-muted-foreground text-xs'>{label}</p>
        <p className={`text-2xl font-bold${destructive ? ' text-destructive' : ''}`}>{value}</p>
      </CardContent>
    </Card>
  );
}

export function DeliveryLogList() {
  const { user } = useAuth();
  const allowed = user?.role !== null && HR_ROLES.includes(user?.role ?? '');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [logs, setLogs] = useState<DeliveryLog[]>([]);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(1);
  const [summary, setSummary] = useState<DeliverySummary | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);

  const [channel, setChannel] = useState('');
  const [status, setStatus] = useState('');
  const [event, setEvent] = useState('');
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const filters = {
        channel: channel || undefined,
        status: status || undefined,
        event: event || undefined,
        search: search || undefined,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
        page,
      };
      const [data, sum] = await Promise.all([listDeliveryLogs(filters), getDeliverySummary(filters)]);
      setLogs(data.results);
      setCount(data.count);
      setSummary(sum);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat riwayat delivery.');
    } finally {
      setLoading(false);
    }
  }, [channel, status, event, search, dateFrom, dateTo, page]);

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- initial data fetch
    load();
  }, [load]);

  function reset() {
    setChannel('');
    setStatus('');
    setEvent('');
    setSearch('');
    setDateFrom('');
    setDateTo('');
    setPage(1);
  }

  if (!allowed) {
    return (
      <Card>
        <CardContent className='py-10 text-center'>
          <p className='font-medium'>Akses ditolak</p>
          <p className='text-muted-foreground text-sm'>
            Hanya HR/Admin yang dapat melihat riwayat delivery notifikasi.
          </p>
        </CardContent>
      </Card>
    );
  }

  const totalPages = Math.max(1, Math.ceil(count / PAGE_SIZE));

  return (
    <div className='flex flex-1 flex-col gap-4 p-4 md:p-6'>
      <div className='flex flex-wrap items-start justify-between gap-4'>
        <div>
          <h2 className='text-2xl font-bold tracking-tight'>Riwayat Delivery Notifikasi</h2>
          <p className='text-muted-foreground text-sm'>
            Log pengiriman email & in-app notification: status terkirim/gagal per penerima.
          </p>
        </div>
        <Button variant='outline' size='sm' onClick={load} disabled={loading}>
          <Icons.refresh />
          Muat Ulang
        </Button>
      </div>

      {summary && (
        <div className='grid grid-cols-2 gap-3 md:grid-cols-4'>
          <SummaryCard label='Total' value={summary.total} />
          <SummaryCard label='Terkirim' value={summary.sent} />
          <SummaryCard label='Gagal' value={summary.failed} destructive />
          <SummaryCard label='Dilewati' value={summary.skipped} />
        </div>
      )}

      <Card>
        <CardContent className='flex flex-wrap items-end gap-2 p-4'>
          <div className='flex flex-col gap-1'>
            <label htmlFor='dl-channel' className='text-muted-foreground text-xs'>Channel</label>
            <select id='dl-channel' className={SELECT_CLASS} value={channel} onChange={(e) => setChannel(e.target.value)}>
              <option value=''>Semua</option>
              <option value='EMAIL'>Email</option>
              <option value='IN_APP'>In-app</option>
            </select>
          </div>
          <div className='flex flex-col gap-1'>
            <label htmlFor='dl-status' className='text-muted-foreground text-xs'>Status</label>
            <select id='dl-status' className={SELECT_CLASS} value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value=''>Semua</option>
              {Object.entries(DELIVERY_STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>
          <div className='flex flex-col gap-1'>
            <label htmlFor='dl-event' className='text-muted-foreground text-xs'>Event</label>
            <select id='dl-event' className={SELECT_CLASS} value={event} onChange={(e) => setEvent(e.target.value)}>
              <option value=''>Semua</option>
              {EVENT_OPTIONS.map((e) => (
                <option key={e} value={e}>{DELIVERY_EVENT_LABELS[e] ?? e}</option>
              ))}
            </select>
          </div>
          <div className='flex flex-col gap-1'>
            <label htmlFor='dl-search' className='text-muted-foreground text-xs'>Cari</label>
            <Input id='dl-search' value={search} onChange={(e) => setSearch(e.target.value)} placeholder='email / subject' className='h-8 w-44' />
          </div>
          <div className='flex flex-col gap-1'>
            <label htmlFor='dl-from' className='text-muted-foreground text-xs'>Dari</label>
            <Input id='dl-from' type='date' value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className='h-8' />
          </div>
          <div className='flex flex-col gap-1'>
            <label htmlFor='dl-to' className='text-muted-foreground text-xs'>Sampai</label>
            <Input id='dl-to' type='date' value={dateTo} onChange={(e) => setDateTo(e.target.value)} className='h-8' />
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
                  <TableHead>Waktu</TableHead>
                  <TableHead>Channel</TableHead>
                  <TableHead>Event</TableHead>
                  <TableHead>Penerima</TableHead>
                  <TableHead>Subject</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.map((log) => (
                  <TableRow
                    key={log.id}
                    className='cursor-pointer'
                    onClick={() => setExpanded(expanded === log.id ? null : log.id)}
                  >
                    <TableCell className='whitespace-nowrap'>{fmtTime(log.created_at)}</TableCell>
                    <TableCell><ChannelBadge channel={log.channel} /></TableCell>
                    <TableCell>{DELIVERY_EVENT_LABELS[log.event] ?? log.event}</TableCell>
                    <TableCell>
                      {log.recipient_email || log.recipient_username || '-'}
                    </TableCell>
                    <TableCell className='max-w-56 truncate'>{log.subject || '-'}</TableCell>
                    <TableCell>
                      <div className='flex items-center gap-2'>
                        <StatusBadge status={log.status} />
                        {log.detail && (
                          <Icons.info className='text-muted-foreground size-3.5' aria-hidden='true' />
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {logs.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className='text-muted-foreground py-8 text-center'>
                      Belum ada log delivery yang cocok.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {count > PAGE_SIZE && (
        <div className='flex items-center justify-between'>
          <p className='text-muted-foreground text-sm'>
            Halaman {page} dari {totalPages} ({count} log)
          </p>
          <div className='flex gap-2'>
            <Button variant='outline' size='sm' disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Sebelumnya
            </Button>
            <Button variant='outline' size='sm' disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
              Berikutnya
            </Button>
          </div>
        </div>
      )}

      {expanded !== null && (() => {
        const log = logs.find((l) => l.id === expanded);
        if (!log) return null;
        return (
          <Card>
            <CardContent className='space-y-3 p-4'>
              <div className='flex items-center justify-between'>
                <h3 className='font-semibold'>Detail Delivery</h3>
                <Button variant='ghost' size='sm' onClick={() => setExpanded(null)}>Tutup</Button>
              </div>
              <div className='grid grid-cols-1 gap-2 text-sm md:grid-cols-2'>
                <p><span className='text-muted-foreground'>Channel:</span> {DELIVERY_CHANNEL_LABELS[log.channel] ?? log.channel}</p>
                <p><span className='text-muted-foreground'>Event:</span> {DELIVERY_EVENT_LABELS[log.event] ?? log.event}</p>
                <p><span className='text-muted-foreground'>Status:</span> {DELIVERY_STATUS_LABELS[log.status] ?? log.status}</p>
                <p><span className='text-muted-foreground'>Waktu:</span> {fmtTime(log.created_at)}</p>
                <p className='md:col-span-2'><span className='text-muted-foreground'>Email penerima:</span> {log.recipient_email || '-'}</p>
                <p className='md:col-span-2'><span className='text-muted-foreground'>User in-app:</span> {log.recipient_username || '-'}</p>
                <p className='md:col-span-2'><span className='text-muted-foreground'>Subject:</span> {log.subject || '-'}</p>
              </div>
              {log.detail && (
                <div>
                  <p className='text-muted-foreground mb-1 text-xs font-medium'>Detail Error</p>
                  <pre className='bg-muted max-h-40 overflow-auto rounded-lg p-2 text-xs whitespace-pre-wrap'>{log.detail}</pre>
                </div>
              )}
              <p className='text-muted-foreground break-all font-mono text-xs'>{log.key}</p>
            </CardContent>
          </Card>
        );
      })()}
    </div>
  );
}
