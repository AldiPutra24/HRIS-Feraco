'use client';

/**
 * Article create/edit modal (rendered on-demand so state initializes from
 * props — avoids set-state-in-effect, per repo convention). Rich text uses
 * the shared EmailBodyEditor contentEditable engine; content is sanitized
 * server-side on save regardless of client behavior.
 */

import { useState } from 'react';
import { toast } from 'react-toastify';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  createKmsArticle,
  updateKmsArticle,
  type KmsArticle,
  type KmsArticleInput,
  type KmsCategoryNode,
  type KmsStatus,
} from '@/lib/kms';
import { EmailBodyEditor } from '@/features/settings/email-body-editor';

type Props = {
  article: KmsArticle | null;
  tree: KmsCategoryNode[];
  onClose: () => void;
  onSaved: () => void;
};

export function ArticleFormModal({ article, tree, onClose, onSaved }: Props) {
  const [title, setTitle] = useState(article?.title ?? '');
  const [summary, setSummary] = useState(article?.summary ?? '');
  const [content, setContent] = useState(article?.content ?? '');
  const [categoryId, setCategoryId] = useState<number | ''>(
    article?.category ?? (tree[0]?.id ?? ''),
  );
  const [subcategoryId, setSubcategoryId] = useState<number | ''>(article?.subcategory ?? '');
  const [status, setStatus] = useState<KmsStatus>(article?.status ?? 'DRAFT');
  const [saving, setSaving] = useState(false);

  const selectedRoot = tree.find((n) => n.id === Number(categoryId));
  const children = selectedRoot?.children ?? [];

  async function save() {
    if (!title.trim() || !content.trim() || categoryId === '') {
      toast.error('Judul, kategori, dan konten wajib diisi.');
      return;
    }
    setSaving(true);
    const payload: KmsArticleInput = {
      title: title.trim(),
      summary: summary.trim(),
      content,
      category: Number(categoryId),
      subcategory: subcategoryId === '' ? null : Number(subcategoryId),
      status,
    };
    try {
      if (article) {
        await updateKmsArticle(article.id, payload);
        toast.success('Knowledge diperbarui.');
      } else {
        await createKmsArticle(payload);
        toast.success('Knowledge dibuat.');
      }
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal menyimpan.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4'>
      <div className='bg-background flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border shadow-lg'>
        <div className='flex items-center justify-between border-b px-4 py-3'>
          <p className='text-sm font-semibold'>
            {article ? 'Edit Knowledge' : 'Tambah Knowledge'}
          </p>
          <Button variant='ghost' size='icon-sm' onClick={onClose} aria-label='Tutup'>
            ✕
          </Button>
        </div>
        <div className='flex-1 space-y-4 overflow-y-auto px-4 py-4'>
          <div>
            <Label className='mb-1 block text-xs'>Judul</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder='Mis. Cara Mengajukan Izin & Cuti'
            />
          </div>
          <div className='grid gap-3 sm:grid-cols-3'>
            <div>
              <Label className='mb-1 block text-xs'>Kategori</Label>
              <select
                className='bg-background h-9 w-full rounded-xl border px-2 text-sm'
                value={categoryId}
                onChange={(e) => {
                  setCategoryId(e.target.value === '' ? '' : Number(e.target.value));
                  setSubcategoryId('');
                }}
              >
                <option value=''>Pilih…</option>
                {tree.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label className='mb-1 block text-xs'>Subkategori (opsional)</Label>
              <select
                className='bg-background h-9 w-full rounded-xl border px-2 text-sm'
                value={subcategoryId}
                onChange={(e) => setSubcategoryId(e.target.value === '' ? '' : Number(e.target.value))}
                disabled={!children.length}
              >
                <option value=''>—</option>
                {children.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label className='mb-1 block text-xs'>Status</Label>
              <select
                className='bg-background h-9 w-full rounded-xl border px-2 text-sm'
                value={status}
                onChange={(e) => setStatus(e.target.value as KmsStatus)}
              >
                <option value='DRAFT'>Draft</option>
                <option value='PUBLISHED'>Terbit</option>
              </select>
            </div>
          </div>
          <div>
            <Label className='mb-1 block text-xs'>Ringkasan</Label>
            <textarea
              className='bg-background min-h-16 w-full rounded-xl border px-3 py-2 text-sm'
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder='Ringkasan singkat untuk tampilan kartu & pencarian'
              maxLength={400}
            />
          </div>
          <div>
            <Label className='mb-1 block text-xs'>Konten</Label>
            <EmailBodyEditor
              value={content}
              onChange={setContent}
              placeholders={[]}
            />
          </div>
        </div>
        <div className='flex justify-end gap-2 border-t px-4 py-3'>
          <Button variant='outline' onClick={onClose}>
            Batal
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? 'Menyimpan…' : 'Simpan'}
          </Button>
        </div>
      </div>
    </div>
  );
}
