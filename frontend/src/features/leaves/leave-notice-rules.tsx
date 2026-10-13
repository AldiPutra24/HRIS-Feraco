'use client';

import { useState } from 'react';
import { toast } from 'react-toastify';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { updateLeaveType, type LeaveType } from '@/lib/leaves';

/**
 * HR setting: minimum notice per leave/permission type ("paling lambat H-N").
 * 0 = no minimum (e.g. Izin Sakit). Enforced by the backend on submission.
 */
export function LeaveNoticeRules({ types, onSaved }: { types: LeaveType[]; onSaved: (t: LeaveType) => void }) {
  const active = types.filter((t) => t.is_active);
  const [draft, setDraft] = useState<Record<number, string>>({});
  const [saving, setSaving] = useState<number | null>(null);

  async function save(t: LeaveType) {
    const raw = draft[t.id] ?? String(t.min_notice_days);
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 0 || value > 365) {
      toast.error('Isi angka hari 0–365.');
      return;
    }
    setSaving(t.id);
    try {
      const updated = await updateLeaveType(t.id, { min_notice_days: value });
      onSaved(updated);
      setDraft((d) => {
        const next = { ...d };
        delete next[t.id];
        return next;
      });
      toast.success(`${t.name}: minimal pengajuan disimpan.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal menyimpan.');
    } finally {
      setSaving(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Aturan Minimal Pengajuan</CardTitle>
        <CardDescription>
          Jumlah hari minimal sebelum tanggal izin/cuti (mis. 7 = paling lambat H-7). Isi 0 bila tidak ada batas,
          misalnya untuk izin sakit.
        </CardDescription>
      </CardHeader>
      <CardContent className='p-0'>
        <div className='overflow-x-auto'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className='pl-6'>Kategori</TableHead>
                <TableHead>Jenis</TableHead>
                <TableHead>Aturan Saat Ini</TableHead>
                <TableHead className='pr-6 text-right'>Minimal Pengajuan (hari)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {active.map((t) => {
                const value = draft[t.id] ?? String(t.min_notice_days);
                const dirty = value !== String(t.min_notice_days);
                return (
                  <TableRow key={t.id}>
                    <TableCell className='pl-6 font-medium'>{t.name}</TableCell>
                    <TableCell>{t.kind === 'PERMISSION' ? 'Izin' : 'Cuti'}</TableCell>
                    <TableCell>
                      {t.min_notice_days > 0 ? (
                        <Badge variant='secondary'>Paling lambat H-{t.min_notice_days}</Badge>
                      ) : (
                        <span className='text-muted-foreground text-sm'>Tanpa batas</span>
                      )}
                    </TableCell>
                    <TableCell className='pr-6'>
                      <div className='flex items-center justify-end gap-2'>
                        <Input
                          type='number'
                          min={0}
                          max={365}
                          className='h-8 w-20 text-right'
                          value={value}
                          onChange={(e) => setDraft((d) => ({ ...d, [t.id]: e.target.value }))}
                          aria-label={`Minimal pengajuan ${t.name}`}
                        />
                        <Button size='sm' variant='outline' disabled={!dirty || saving === t.id} onClick={() => save(t)}>
                          {saving === t.id ? 'Menyimpan...' : 'Simpan'}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
