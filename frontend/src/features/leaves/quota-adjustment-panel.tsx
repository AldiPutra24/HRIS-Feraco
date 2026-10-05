'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  createQuotaAdjustment,
  formatDays,
  listQuotaAdjustments,
  type LeaveQuotaAdjustment,
  type LeaveType
} from '@/lib/leaves';

/**
 * HR manual quota adjustment (+/-, step 0,5) with audit trail.
 * Balance = quota + adjustment - usage; the base quota is never edited.
 */
export function QuotaAdjustmentPanel({
  employeeId,
  year,
  types,
  onSaved
}: {
  employeeId: number;
  year: number;
  types: LeaveType[];
  onSaved: () => void;
}) {
  const quotaTypes = types.filter((t) => t.code === 'ANNUAL' || t.default_quota > 0);
  const [rows, setRows] = useState<LeaveQuotaAdjustment[]>([]);
  const [leaveType, setLeaveType] = useState<number | ''>('');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const selectedType = leaveType || quotaTypes[0]?.id || '';

  const load = useCallback(async () => {
    try {
      setRows(await listQuotaAdjustments({ employee: String(employeeId), year: String(year) }));
    } catch {
      setRows([]);
    }
  }, [employeeId, year]);

  useEffect(() => {
    load();
  }, [load]);

  async function save() {
    const value = Number(amount.replace(',', '.'));
    if (!selectedType) {
      toast.error('Pilih jenis kuota.');
      return;
    }
    if (!value || Math.round(value * 2) !== value * 2) {
      toast.error('Adjustment harus angka kelipatan 0,5 dan tidak 0 (contoh: 2, -1, 0,5).');
      return;
    }
    if (!reason.trim()) {
      toast.error('Alasan adjustment wajib diisi.');
      return;
    }
    setSaving(true);
    try {
      await createQuotaAdjustment({
        employee: employeeId,
        leave_type: Number(selectedType),
        year,
        amount: value,
        reason: reason.trim()
      });
      toast.success('Adjustment kuota disimpan.');
      setAmount('');
      setReason('');
      await load();
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal menyimpan adjustment.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className='space-y-3 border-t pt-3'>
      <p className='text-sm font-medium'>Adjustment Kuota ({year})</p>
      <div className='grid grid-cols-1 gap-2 md:grid-cols-4'>
        <div>
          <Label className='text-xs'>Jenis Kuota</Label>
          <select
            aria-label='Jenis kuota'
            className='border-input h-9 w-full rounded-lg border bg-transparent px-2.5 text-sm'
            value={selectedType}
            onChange={(e) => setLeaveType(e.target.value ? Number(e.target.value) : '')}
          >
            {quotaTypes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label className='text-xs'>Adjustment (+/- hari)</Label>
          <Input
            inputMode='decimal'
            placeholder='mis. 2, -1, 0,5'
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>
        <div className='md:col-span-2'>
          <Label className='text-xs'>Alasan *</Label>
          <Input
            placeholder='mis. Bonus kuota karena lembur'
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
      </div>
      <Button size='sm' disabled={saving} onClick={save}>
        {saving ? 'Menyimpan...' : 'Simpan Adjustment'}
      </Button>
      {rows.length > 0 && (
        <div className='overflow-x-auto'>
          <table className='w-full text-sm'>
            <TableHeader>
              <TableRow>
                <TableHead>Waktu</TableHead>
                <TableHead>Jenis</TableHead>
                <TableHead>Tahun</TableHead>
                <TableHead className='text-right'>Adjustment</TableHead>
                <TableHead>Alasan</TableHead>
                <TableHead>Dibuat oleh</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className='whitespace-nowrap'>{new Date(r.created_at).toLocaleString('id-ID')}</TableCell>
                  <TableCell>{r.leave_type_name}</TableCell>
                  <TableCell>{r.year}</TableCell>
                  <TableCell className={`text-right font-medium ${r.amount < 0 ? 'text-destructive' : 'text-emerald-600'}`}>
                    {r.amount > 0 ? '+' : ''}
                    {formatDays(r.amount)}
                  </TableCell>
                  <TableCell className='max-w-64 whitespace-normal'>{r.reason}</TableCell>
                  <TableCell>{r.created_by_name ?? '-'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </table>
        </div>
      )}
    </div>
  );
}
