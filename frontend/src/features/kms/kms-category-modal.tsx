'use client';

/**
 * Category manager modal (KMS managers only, rendered on-demand).
 * Two-level tree: add root / subcategory, rename, toggle active, delete
 * unused. Depth rules are enforced server-side; messages surface via toast.
 */

import { useState } from 'react';
import { toast } from 'react-toastify';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  createKmsCategory,
  deleteKmsCategory,
  updateKmsCategory,
  type KmsCategoryNode,
} from '@/lib/kms';

type Props = {
  tree: KmsCategoryNode[];
  onClose: () => void;
  onChanged: () => void;
};

export function CategoryManagerModal({ tree, onClose, onChanged }: Props) {
  const [busy, setBusy] = useState(false);
  const [newRoot, setNewRoot] = useState('');
  const [newSub, setNewSub] = useState<{ parent: number | ''; name: string }>({
    parent: '',
    name: '',
  });

  async function run(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    try {
      await fn();
      toast.success(ok);
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4'>
      <div className='bg-background flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border shadow-lg'>
        <div className='flex items-center justify-between border-b px-4 py-3'>
          <p className='text-sm font-semibold'>Kelola Kategori</p>
          <Button variant='ghost' size='icon-sm' onClick={onClose} aria-label='Tutup'>
            ✕
          </Button>
        </div>
        <div className='flex-1 space-y-5 overflow-y-auto px-4 py-4'>
          {/* New root */}
          <div className='space-y-2'>
            <Label className='text-xs'>Kategori Utama Baru</Label>
            <div className='flex gap-2'>
              <Input
                value={newRoot}
                onChange={(e) => setNewRoot(e.target.value)}
                placeholder='Mis. HRIS / Internal'
              />
              <Button
                variant='outline'
                disabled={busy || !newRoot.trim()}
                onClick={() =>
                  run(
                    () => createKmsCategory({ name: newRoot.trim() }),
                    'Kategori dibuat.',
                  ).then(() => setNewRoot(''))
                }
              >
                Tambah
              </Button>
            </div>
          </div>

          {/* New subcategory */}
          <div className='space-y-2'>
            <Label className='text-xs'>Subkategori Baru</Label>
            <div className='flex gap-2'>
              <select
                className='bg-background h-9 rounded-xl border px-2 text-sm'
                value={newSub.parent}
                onChange={(e) => setNewSub({ ...newSub, parent: Number(e.target.value) })}
              >
                <option value=''>Pilih kategori…</option>
                {tree.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.name}
                  </option>
                ))}
              </select>
              <Input
                className='flex-1'
                value={newSub.name}
                onChange={(e) => setNewSub({ ...newSub, name: e.target.value })}
                placeholder='Mis. Pengajuan Cuti'
              />
              <Button
                variant='outline'
                disabled={busy || newSub.parent === '' || !newSub.name.trim()}
                onClick={() =>
                  run(
                    () =>
                      createKmsCategory({
                        name: newSub.name.trim(),
                        parent: Number(newSub.parent),
                      }),
                    'Subkategori dibuat.',
                  ).then(() => setNewSub({ parent: '', name: '' }))
                }
              >
                Tambah
              </Button>
            </div>
          </div>

          {/* Existing tree */}
          <div className='space-y-3'>
            {tree.map((node) => (
              <div key={node.id} className='rounded-xl border p-3'>
                <div className='flex items-center gap-2'>
                  <Input
                    className='h-8 flex-1 text-sm'
                    defaultValue={node.name}
                    onBlur={(e) => {
                      const name = e.target.value.trim();
                      if (name && name !== node.name) {
                        run(() => updateKmsCategory(node.id, { name }), 'Kategori diubah.');
                      }
                    }}
                  />
                  <Button
                    variant='ghost'
                    size='sm'
                    disabled={busy}
                    onClick={() =>
                      run(
                        () =>
                          updateKmsCategory(node.id, { is_active: !node.is_active }),
                        node.is_active ? 'Kategori dinonaktifkan.' : 'Kategori diaktifkan.',
                      )
                    }
                  >
                    {node.is_active ? 'Nonaktifkan' : 'Aktifkan'}
                  </Button>
                  <Button
                    variant='ghost'
                    size='sm'
                    disabled={busy}
                    onClick={() =>
                      run(() => deleteKmsCategory(node.id), 'Kategori dihapus.')
                    }
                  >
                    Hapus
                  </Button>
                </div>
                {node.children.length > 0 && (
                  <div className='mt-2 space-y-1.5 border-l pl-3'>
                    {node.children.map((child) => (
                      <div key={child.id} className='flex items-center gap-2'>
                        <Input
                          className='h-7 flex-1 text-xs'
                          defaultValue={child.name}
                          onBlur={(e) => {
                            const name = e.target.value.trim();
                            if (name && name !== child.name) {
                              run(
                                () => updateKmsCategory(child.id, { name }),
                                'Subkategori diubah.',
                              );
                            }
                          }}
                        />
                        <span className='text-muted-foreground text-[10px]'>
                          {child.article_count} materi
                        </span>
                        <Button
                          variant='ghost'
                          size='sm'
                          className='h-7 text-xs'
                          disabled={busy}
                          onClick={() =>
                            run(
                              () =>
                                updateKmsCategory(child.id, { is_active: !child.is_active }),
                              child.is_active ? 'Subkategori dinonaktifkan.' : 'Subkategori diaktifkan.',
                            )
                          }
                        >
                          {child.is_active ? 'Nonaktifkan' : 'Aktifkan'}
                        </Button>
                        <Button
                          variant='ghost'
                          size='sm'
                          className='h-7 text-xs'
                          disabled={busy}
                          onClick={() =>
                            run(() => deleteKmsCategory(child.id), 'Subkategori dihapus.')
                          }
                        >
                          Hapus
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
          <p className='text-muted-foreground text-xs'>
            Kategori yang masih dipakai knowledge tidak dapat dihapus (hanya dinonaktifkan).
          </p>
        </div>
        <div className='flex justify-end gap-2 border-t px-4 py-3'>
          <Button onClick={onClose}>Selesai</Button>
        </div>
      </div>
    </div>
  );
}
