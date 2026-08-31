'use client';

import { useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import { Button } from '@/components/ui/button';
import { Icons } from '@/components/icons';
import { cn } from '@/lib/utils';
import { importEmployees, type ImportResult } from '@/lib/employees';

const TEMPLATE_COLUMNS = [
  'full_name', 'nik', 'birth_place', 'birth_date', 'address', 'phone',
  'personal_email', 'company_email', 'emergency_contact_name', 'emergency_contact_phone',
  'bank_account_number', 'bank_account_name', 'npwp', 'bpjs_kesehatan',
  'bpjs_ketenagakerjaan', 'department', 'position', 'join_date', 'employment_status'
];

function downloadTemplate() {
  const rows = [
    TEMPLATE_COLUMNS,
    [
      'Budi Santoso', '1234567890123456', 'Jakarta', '1990-01-01', 'Jl. Merdeka 1', '081234567890',
      'budi@mail.com', 'budi@feraco.co.id', 'Budi', '081234567890', '1234567890', 'Budi Santoso',
      '1234567890123456', '1234567890123', '1234567890123', 'Engineering', 'Software Engineer', '2024-01-15', 'ACTIVE'
    ]
  ];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Karyawan');
  XLSX.writeFile(wb, 'template-karyawan.xlsx');
}

type Props = { open: boolean; onOpenChange: (open: boolean) => void; onImported: () => void };

export function ImportDialog({ open, onOpenChange, onImported }: Props) {
  const [dragging, setDragging] = useState(false);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState('');
  const [fileName, setFileName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  async function doImport(file: File) {
    setImporting(true);
    setResult(null);
    setError('');
    setFileName(file.name);
    try {
      const res = await importEmployees(file);
      setResult(res);
      onImported();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import gagal.');
    } finally {
      setImporting(false);
    }
  }

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) doImport(file);
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) doImport(file);
  }

  function reset() {
    setResult(null);
    setError('');
    setFileName('');
  }

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className='fixed inset-0 z-50 bg-black/50 transition-opacity data-ending-style:opacity-0 data-starting-style:opacity-0' />
        <DialogPrimitive.Popup
          className='fixed top-1/2 left-1/2 z-50 w-[90vw] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-xl border bg-popover p-6 text-popover-foreground shadow-lg transition data-ending-style:opacity-0 data-ending-style:scale-95 data-starting-style:opacity-0 data-starting-style:scale-95'
        >
          <div className='flex items-start justify-between'>
            <div>
              <DialogPrimitive.Title className='text-base font-semibold'>Import Karyawan</DialogPrimitive.Title>
              <DialogPrimitive.Description className='text-muted-foreground text-sm'>
                Unggah file XLSX untuk menambah karyawan secara massal.
              </DialogPrimitive.Description>
            </div>
            <DialogPrimitive.Close
              render={
                <Button variant='ghost' size='icon-sm' onClick={reset} aria-label='Tutup' />
              }
            >
              <Icons.close />
            </DialogPrimitive.Close>
          </div>

          <div className='mt-4 space-y-4'>
            <button
              type='button'
              onClick={() => inputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              className={cn(
                'flex w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-8 text-center transition-colors',
                dragging ? 'border-primary bg-primary/5' : 'border-border'
              )}
            >
              <Icons.upload className='text-muted-foreground size-8' />
              <span className='text-sm font-medium'>Tarik & lepas file XLSX di sini</span>
              <span className='text-muted-foreground text-xs'>atau klik untuk memilih file</span>
            </button>

            <input ref={inputRef} type='file' accept='.xlsx' className='hidden' onChange={onPick} />

            <div className='flex items-center justify-between'>
              <Button variant='outline' size='sm' onClick={() => inputRef.current?.click()}>
                <Icons.search />
                Cari dari komputer
              </Button>
              <Button variant='ghost' size='sm' onClick={downloadTemplate}>
                <Icons.post />
                Download template
              </Button>
            </div>

            {importing && <p className='text-muted-foreground text-sm'>Mengimport {fileName}...</p>}

            {error && <p className='text-destructive text-sm'>{error}</p>}

            {result && (
              <div className='rounded-lg border p-3 text-sm'>
                <p>
                  Berhasil import <span className='font-semibold'>{result.created}</span> karyawan.
                </p>
                {result.errors.length > 0 && (
                  <div className='mt-2 space-y-1'>
                    <p className='text-destructive font-medium'>Gagal {result.errors.length} baris:</p>
                    <ul className='text-muted-foreground max-h-32 list-disc overflow-auto pl-5 text-xs'>
                      {result.errors.map((e, i) => (
                        <li key={i}>
                          Baris {e.row}: {e.error}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
