'use client';

/**
 * Article detail (rendered client-side; /kms/[id] route). Managers get
 * Edit / Archive / Restore / Delete; everyone else read-only. Related
 * knowledge = same subcategory, then same category (published only).
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'react-toastify';
import { Icons } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/lib/auth/auth-provider';
import {
  KMS_STATUS_LABELS,
  archiveKmsArticle,
  deleteKmsArticle,
  getKmsArticle,
  getKmsAttachmentUrl,
  listRelatedKmsArticles,
  restoreKmsArticle,
  type KmsArticle,
} from '@/lib/kms';
import { cn } from '@/lib/utils';

import { ArticleFormModal } from './kms-article-modal';

const KMS_ROLES: ReadonlySet<string> = new Set(['admin', 'hr_staff', 'hr_lead']);

function formatDate(iso: string | null): string {
  if (!iso) return '-';
  return new Date(iso).toLocaleDateString('id-ID', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export function KmsArticleDetail({ id }: { id: number }) {
  const router = useRouter();
  const { user } = useAuth();
  const canManage = KMS_ROLES.has(user?.role ?? '');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [article, setArticle] = useState<KmsArticle | null>(null);
  const [related, setRelated] = useState<KmsArticle[]>([]);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [a, rel] = await Promise.all([
        getKmsArticle(id),
        listRelatedKmsArticles(id).catch(() => []),
      ]);
      setArticle(a);
      setRelated(rel);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat knowledge.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    // eslint-disable-next-line react/set-state-in-effect -- initial data fetch (konvensi repo)
    load();
  }, [load]);

  async function openAttachment() {
    if (!article?.has_attachment) return;
    try {
      const { url } = await getKmsAttachmentUrl(article.id);
      window.open(url, '_blank', 'noopener');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal membuka lampiran.');
    }
  }

  async function toggleArchive() {
    if (!article) return;
    try {
      const updated =
        article.status === 'ARCHIVED'
          ? await restoreKmsArticle(article.id)
          : await archiveKmsArticle(article.id);
      setArticle(updated);
      toast.success(
        updated.status === 'ARCHIVED' ? 'Knowledge diarsipkan.' : 'Dipulihkan ke draft.',
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal.');
    }
  }

  async function doDelete() {
    if (!article) return;
    try {
      await deleteKmsArticle(article.id);
      toast.success('Knowledge dihapus.');
      router.push('/kms');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal menghapus.');
    }
  }

  if (loading) {
    return (
      <div className='mx-auto max-w-3xl space-y-4 p-4 md:p-6'>
        <Skeleton className='h-8 w-2/3' />
        <Skeleton className='h-4 w-1/3' />
        <Skeleton className='h-64 w-full rounded-xl' />
      </div>
    );
  }

  if (error || !article) {
    return (
      <div className='mx-auto max-w-3xl p-4 md:p-6'>
        <Card>
          <CardContent className='flex flex-col items-center gap-3 py-12 text-center'>
            <Icons.circleX className='text-destructive size-8' />
            <p className='text-sm font-medium'>Knowledge tidak ditemukan</p>
            <p className='text-muted-foreground text-xs'>{error}</p>
            <Button variant='outline' size='sm' render={<Link href='/kms' aria-label='Kembali ke KMS' />}>
              Kembali ke KMS
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className='mx-auto max-w-3xl space-y-6 p-4 md:p-6'>
      <div>
        <Button variant='ghost' size='sm' render={<Link href='/kms' aria-label='Kembali ke KMS' />}>
          <Icons.arrowLeft className='size-4' />
          Kembali
        </Button>
      </div>

      <div className='space-y-3'>
        <div className='flex flex-wrap items-start justify-between gap-3'>
          <h1 className='text-2xl font-bold tracking-tight'>{article.title}</h1>
          {canManage && (
            <span
              className={cn(
                'rounded-full px-2 py-0.5 text-[10px] font-medium',
                article.status === 'PUBLISHED' && 'bg-emerald-500/10 text-emerald-600',
                article.status === 'DRAFT' && 'bg-muted text-muted-foreground',
                article.status === 'ARCHIVED' && 'bg-amber-500/10 text-amber-600',
              )}
            >
              {KMS_STATUS_LABELS[article.status]}
            </span>
          )}
        </div>
        <div className='text-muted-foreground flex flex-wrap items-center gap-2 text-xs'>
          <span className='bg-muted rounded px-1.5 py-0.5'>{article.category_name}</span>
          {article.subcategory_name && (
            <span className='bg-muted rounded px-1.5 py-0.5'>
              {article.subcategory_name}
            </span>
          )}
          <span>•</span>
          <span>Dibuat {article.created_by_name ?? '-'} • {formatDate(article.created_at)}</span>
          <span>•</span>
          <span>Update terakhir {article.updated_by_name ?? '-'} • {formatDate(article.updated_at)}</span>
        </div>
      </div>

      {canManage && (
        <div className='flex flex-wrap gap-2'>
          <Button variant='outline' size='sm' onClick={() => setEditing(true)}>
            <Icons.edit className='size-4' />
            Edit
          </Button>
          <Button variant='outline' size='sm' onClick={toggleArchive}>
            <Icons.archive className='size-4' />
            {article.status === 'ARCHIVED' ? 'Pulihkan' : 'Arsipkan'}
          </Button>
          <Button
            variant='ghost'
            size='sm'
            className='text-destructive hover:text-destructive'
            onClick={() => setConfirmDelete(true)}
          >
            <Icons.trash className='size-4' />
            Hapus
          </Button>
        </div>
      )}

      <Card>
        <CardContent className='px-6 py-4'>
          {/* Content is server-sanitized (whitelist) before storage; rendered
              as trusted HTML exactly like the stored article. */}
          <div
            className='prose-kms text-sm leading-relaxed [&_a]:text-primary [&_a]:underline [&_blockquote]:border-l-4 [&_blockquote]:border-l-border [&_blockquote]:pl-3 [&_blockquote]:italic [&_h1]:mb-2 [&_h1]:mt-4 [&_h1]:text-lg [&_h1]:font-bold [&_h2]:mb-2 [&_h2]:mt-4 [&_h2]:text-base [&_h2]:font-bold [&_h3]:mb-1 [&_h3]:mt-3 [&_h3]:font-semibold [&_img]:max-w-full [&_li]:ml-4 [&_ol]:list-decimal [&_ol]:pl-2 [&_p]:my-2 [&_table]:w-full [&_td]:border [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:px-2 [&_th]:py-1 [&_ul]:list-disc [&_ul]:pl-2'
            dangerouslySetInnerHTML={{ __html: article.content }}
          />
        </CardContent>
      </Card>

      {article.has_attachment && (
        <Button variant='outline' size='sm' onClick={openAttachment}>
          <Icons.paperclip className='size-4' />
          Lampiran: {article.attachment_name ?? 'file'}
        </Button>
      )}

      {related.length > 0 && (
        <div className='space-y-2'>
          <p className='text-muted-foreground text-xs font-semibold tracking-wide uppercase'>
            Knowledge Terkait
          </p>
          <div className='grid gap-2 sm:grid-cols-2'>
            {related.map((r) => (
              <Link key={r.id} href={`/kms/${r.id}`} aria-label={r.title}>
                <Card className='hover:border-ring transition-colors'>
                  <CardContent className='p-3'>
                    <p className='text-sm font-medium'>{r.title}</p>
                    <p className='text-muted-foreground mt-0.5 text-xs line-clamp-1'>
                      {r.summary || r.category_name}
                    </p>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </div>
      )}

      {editing && (
        <ArticleFormModal
          article={article}
          tree={[]}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            load();
          }}
        />
      )}

      {confirmDelete && (
        <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4'>
          <div className='bg-background w-full max-w-sm rounded-xl border p-4 shadow-lg'>
            <p className='text-sm font-semibold'>Hapus knowledge?</p>
            <p className='text-muted-foreground mt-1 text-xs'>
              “{article.title}” akan dihapus permanen beserta lampirannya.
            </p>
            <div className='mt-4 flex justify-end gap-2'>
              <Button variant='outline' onClick={() => setConfirmDelete(false)}>
                Batal
              </Button>
              <Button variant='destructive' onClick={doDelete}>
                Hapus
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
