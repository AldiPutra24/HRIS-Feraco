'use client';

/**
 * Article create/edit modal (rendered on-demand so state initializes from
 * props — avoids set-state-in-effect, per repo convention). Rich text uses
 * the shared EmailBodyEditor contentEditable engine; content is sanitized
 * server-side on save regardless of client behavior.
 */

import { useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  KMS_VISIBILITY_LABELS,
  createKmsArticle,
  updateKmsArticle,
  type KmsArticle,
  type KmsArticleInput,
  type KmsCategoryNode,
  type KmsStatus,
  type KmsVisibility,
} from '@/lib/kms';
import { listDepartments, type Department } from '@/lib/employees';
import { listUsers, type AdminUser } from '@/lib/users';
import { EmailBodyEditor } from '@/features/settings/email-body-editor';
import { cn } from '@/lib/utils';

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
  const [visibility, setVisibility] = useState<KmsVisibility>(article?.visibility ?? 'ALL');
  const [roleTargets, setRoleTargets] = useState<string[]>(article?.role_targets ?? []);
  const [deptTargets, setDeptTargets] = useState<number[]>(article?.department_targets ?? []);
  const [userTargets, setUserTargets] = useState<number[]>(article?.user_targets ?? []);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [saving, setSaving] = useState(false);

  const selectedRoot = tree.find((n) => n.id === Number(categoryId));
  const children = selectedRoot?.children ?? [];

  useEffect(() => {
    // eslint-disable-next-line react/set-state-in-effect -- initial data fetch (konvensi repo)
    Promise.all([listDepartments(), listUsers()])
      .then(([d, u]) => {
        setDepartments(d);
        setUsers(u);
      })
      .catch(() => {
        /* target pickers degrade gracefully if these fail */
      });
  }, []);

  const ROLE_OPTIONS = [
    { value: 'ADMIN', label: 'Admin' },
    { value: 'HR_LEAD', label: 'HR Lead' },
    { value: 'HR_STAFF', label: 'HR Staff' },
    { value: 'GENERAL_MANAGER', label: 'General Manager' },
    { value: 'MANAGEMENT', label: 'Management' },
    { value: 'EMPLOYEE', label: 'Employee' },
  ];

  function toggleRole(key: string) {
    setRoleTargets((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  }
  function toggleDept(id: number) {
    setDeptTargets((prev) => (prev.includes(id) ? prev.filter((d) => d !== id) : [...prev, id]));
  }
  function toggleUser(id: number) {
    setUserTargets((prev) => (prev.includes(id) ? prev.filter((u) => u !== id) : [...prev, id]));
  }

  async function save() {
    if (!title.trim() || !content.trim() || categoryId === '') {
      toast.error('Judul, kategori, dan konten wajib diisi.');
      return;
    }
    if (visibility === 'ROLE' && roleTargets.length === 0) {
      toast.error('Pilih minimal satu role.');
      return;
    }
    if (visibility === 'DEPARTMENT' && deptTargets.length === 0) {
      toast.error('Pilih minimal satu departemen.');
      return;
    }
    if (visibility === 'USER' && userTargets.length === 0) {
      toast.error('Pilih minimal satu user.');
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
      visibility,
      // Hidden targets are never sent — only lists relevant to the selected
      // visibility are included (backend replaces them atomically).
      ...(visibility === 'ROLE' ? { role_targets: roleTargets } : {}),
      ...(visibility === 'DEPARTMENT' ? { department_targets: deptTargets } : {}),
      ...(visibility === 'USER' ? { user_targets: userTargets } : {}),
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
          {/* Visibilitas */}
          <div className='space-y-2 rounded-xl border p-3'>
            <Label className='block text-xs font-semibold'>Visibilitas</Label>
            <select
              className='bg-background h-9 w-full rounded-xl border px-2 text-sm'
              value={visibility}
              onChange={(e) => setVisibility(e.target.value as KmsVisibility)}
            >
              {(Object.keys(KMS_VISIBILITY_LABELS) as KmsVisibility[]).map((v) => (
                <option key={v} value={v}>
                  {KMS_VISIBILITY_LABELS[v]}
                </option>
              ))}
            </select>
            {visibility === 'ROLE' && (
              <div className='flex flex-wrap gap-2'>
                {ROLE_OPTIONS.map((r) => (
                  <label
                    key={r.value}
                    className={cn(
                      'cursor-pointer rounded-full border px-2.5 py-1 text-xs',
                      roleTargets.includes(r.value)
                        ? 'border-primary bg-primary/10 text-primary font-medium'
                        : 'text-muted-foreground hover:bg-muted',
                    )}
                  >
                    <input
                      type='checkbox'
                      className='sr-only'
                      checked={roleTargets.includes(r.value)}
                      onChange={() => toggleRole(r.value)}
                    />
                    {r.label}
                  </label>
                ))}
              </div>
            )}
            {visibility === 'DEPARTMENT' && (
              <div className='flex flex-wrap gap-2'>
                {departments.map((d) => (
                  <label
                    key={d.id}
                    className={cn(
                      'cursor-pointer rounded-full border px-2.5 py-1 text-xs',
                      deptTargets.includes(d.id)
                        ? 'border-primary bg-primary/10 text-primary font-medium'
                        : 'text-muted-foreground hover:bg-muted',
                    )}
                  >
                    <input
                      type='checkbox'
                      className='sr-only'
                      checked={deptTargets.includes(d.id)}
                      onChange={() => toggleDept(d.id)}
                    />
                    {d.name}
                  </label>
                ))}
              </div>
            )}
            {visibility === 'USER' && (
              <select
                multiple
                value={userTargets.map(String)}
                onChange={(e) =>
                  setUserTargets(Array.from(e.target.selectedOptions, (o) => Number(o.value)))
                }
                className='bg-background h-32 w-full rounded-xl border px-2 text-sm'
                aria-label='Pilih user'
              >
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.username} ({u.email})
                  </option>
                ))}
              </select>
            )}
            {visibility === 'PRIVATE' && (
              <p className='text-muted-foreground text-xs'>
                Artikel ini hanya dapat diakses oleh Anda (pembuat) dan admin KMS.
              </p>
            )}
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
