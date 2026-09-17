'use client';

/**
 * KMS main page — knowledge base, not an admin table.
 *
 * Layout per spec: header (title + description + search + "Tambah Knowledge"
 * for KMS managers), sticky category navigation (Semua / Kategori /
 * Subkategori tree), knowledge cards with summary + meta + status badge
 * (managers only) + updated date. Filter: category, subcategory, status
 * (managers). Pagination via the shared DRF PageNumberPagination.
 * Server-side filtering only (?search= hits title/summary/content/category).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { toast } from 'react-toastify';
import { Icons } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/lib/auth/auth-provider';
import {
  KMS_STATUS_LABELS,
  getKmsCategoryTree,
  listKmsArticles,
  type KmsArticle,
  type KmsCategoryNode,
  type KmsPage,
  type KmsStatus,
} from '@/lib/kms';
import { cn } from '@/lib/utils';

import { ArticleFormModal } from './kms-article-modal';
import { CategoryManagerModal } from './kms-category-modal';

// Mirrors backend WRITE_ROLES (AuthRole casing is lowercase client-side).
const KMS_ROLES: ReadonlySet<string> = new Set(['admin', 'hr_staff', 'hr_lead']);

function formatDate(iso: string | null): string {
  if (!iso) return '-';
  return new Date(iso).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function KmsPage() {
  const { user } = useAuth();
  const canManage = KMS_ROLES.has(user?.role ?? '');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tree, setTree] = useState<KmsCategoryNode[]>([]);
  const [page, setPage] = useState<KmsPage<KmsArticle> | null>(null);

  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [category, setCategory] = useState<number | null>(null);
  const [subcategory, setSubcategory] = useState<number | null>(null);
  const [status, setStatus] = useState<KmsStatus | ''>('');

  const [articleModal, setArticleModal] = useState<{ open: boolean; article: KmsArticle | null }>({
    open: false,
    article: null,
  });
  const [categoryModal, setCategoryModal] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [t, p] = await Promise.all([
        getKmsCategoryTree(),
        listKmsArticles({
          search: search || undefined,
          category: category ?? undefined,
          subcategory: subcategory ?? undefined,
          status: status || undefined,
          page: 1,
        }),
      ]);
      setTree(t);
      setPage(p);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat knowledge.');
    } finally {
      setLoading(false);
    }
  }, [search, category, subcategory, status]);

  useEffect(() => {
    // eslint-disable-next-line react/set-state-in-effect -- initial data fetch (konvensi repo)
    load();
  }, [load]);

  function loadPage(next: number) {
    setLoading(true);
    listKmsArticles({
      search: search || undefined,
      category: category ?? undefined,
      subcategory: subcategory ?? undefined,
      status: status || undefined,
      page: next,
    })
      .then(setPage)
      .catch((err) => toast.error(err instanceof Error ? err.message : 'Gagal memuat halaman.'))
      .finally(() => setLoading(false));
  }

  const activeCategory = useMemo(
    () => tree.find((n) => n.id === category) ?? null,
    [tree, category],
  );

  function pickCategory(id: number | null) {
    setCategory(id);
    setSubcategory(null);
  }

  const hasFilters = search !== '' || category !== null || subcategory !== null || status !== '';

  return (
    <div className='space-y-6 p-4 md:p-6'>
      {/* Header */}
      <div className='flex flex-wrap items-start justify-between gap-4'>
        <div>
          <h1 className='flex items-center gap-2 text-2xl font-bold tracking-tight'>
            <Icons.books className='size-6 text-primary' />
            Knowledge Management
          </h1>
          <p className='text-muted-foreground mt-1 text-sm'>
            Pusat knowledge, panduan, SOP, dan informasi internal FERACO.
          </p>
        </div>
        <div className='flex items-center gap-2'>
          {canManage && (
            <Button variant='outline' onClick={() => setCategoryModal(true)}>
              <Icons.folder className='size-4' />
              Kelola Kategori
            </Button>
          )}
          {canManage && (
            <Button onClick={() => setArticleModal({ open: true, article: null })}>
              <Icons.add className='size-4' />
              Tambah Knowledge
            </Button>
          )}
        </div>
      </div>

      {/* Search + status filter */}
      <div className='flex flex-wrap items-center gap-2'>
        <form
          className='relative w-full max-w-md'
          onSubmit={(e) => {
            e.preventDefault();
            setSearch(searchInput.trim());
          }}
        >
          <Icons.search className='text-muted-foreground pointer-events-none absolute top-2.5 left-3 size-4' />
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder='Cari judul, ringkasan, isi, kategori…'
            className='pl-9'
          />
        </form>
        {canManage && (
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as KmsStatus | '')}
            className='bg-background h-9 rounded-xl border px-2 text-sm'
            aria-label='Filter status'
          >
            <option value=''>Semua status</option>
            <option value='PUBLISHED'>Terbit</option>
            <option value='DRAFT'>Draft</option>
            <option value='ARCHIVED'>Arsip</option>
          </select>
        )}
        {hasFilters && (
          <Button
            variant='ghost'
            size='sm'
            onClick={() => {
              setSearch('');
              setSearchInput('');
              pickCategory(null);
              setStatus('');
            }}
          >
            <Icons.close className='size-4' />
            Reset filter
          </Button>
        )}
      </div>

      <div className='grid gap-6 lg:grid-cols-[240px_1fr]'>
        {/* Category navigation */}
        <aside className='lg:sticky lg:top-20 lg:self-start'>
          <p className='text-muted-foreground mb-2 text-xs font-semibold tracking-wide uppercase'>
            Kategori
          </p>
          <nav className='space-y-1'>
            <button
              type='button'
              onClick={() => pickCategory(null)}
              className={cn(
                'hover:bg-muted flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm',
                category === null && 'bg-muted font-medium',
              )}
            >
              <Icons.dashboard className='text-muted-foreground size-4' />
              Semua
            </button>
            {tree.map((node) => (
              <div key={node.id}>
                <button
                  type='button'
                  onClick={() => pickCategory(node.id)}
                  className={cn(
                    'hover:bg-muted flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm',
                    category === node.id && 'bg-muted font-medium',
                  )}
                >
                  <Icons.folder className='text-muted-foreground size-4' />
                  <span className='flex-1 truncate'>{node.name}</span>
                </button>
                {(category === node.id || subcategory !== null) && node.children.length > 0 && (
                  <div className='ml-4 space-y-0.5 border-l pl-2'>
                    {node.children.map((child) => (
                      <button
                        key={child.id}
                        type='button'
                        onClick={() => {
                          setCategory(node.id);
                          setSubcategory(child.id);
                        }}
                        className={cn(
                          'text-muted-foreground hover:bg-muted flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left text-xs',
                          subcategory === child.id && 'bg-muted text-foreground font-medium',
                        )}
                      >
                        <span className='flex-1 truncate'>{child.name}</span>
                        <span className='tabular-nums opacity-60'>{child.article_count}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </nav>
        </aside>

        {/* Knowledge cards */}
        <main className='space-y-3'>
          {loading && !page ? (
            <div className='space-y-3'>
              {[1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className='h-28 w-full rounded-xl' />
              ))}
            </div>
          ) : error ? (
            <Card>
              <CardContent className='flex flex-col items-center gap-3 py-12 text-center'>
                <Icons.circleX className='text-destructive size-8' />
                <p className='text-sm font-medium'>Gagal memuat knowledge</p>
                <p className='text-muted-foreground text-xs'>{error}</p>
                <Button variant='outline' size='sm' onClick={load}>
                  <Icons.refresh className='size-4' />
                  Coba lagi
                </Button>
              </CardContent>
            </Card>
          ) : !page || page.results.length === 0 ? (
            <Card>
              <CardContent className='flex flex-col items-center gap-3 py-12 text-center'>
                <Icons.books className='text-muted-foreground/50 size-10' />
                <p className='text-sm font-medium'>
                  {hasFilters ? 'Tidak ada knowledge yang cocok.' : 'Belum ada knowledge.'}
                </p>
                <p className='text-muted-foreground max-w-sm text-xs'>
                  {hasFilters
                    ? 'Coba kata kunci lain atau reset filter.'
                    : canManage
                      ? 'Mulai dengan menambahkan knowledge pertama.'
                      : 'Knowledge akan muncul di sini setelah dipublikasikan HR.'}
                </p>
                {canManage && !hasFilters && (
                  <Button size='sm' onClick={() => setArticleModal({ open: true, article: null })}>
                    <Icons.add className='size-4' />
                    Tambah Knowledge
                  </Button>
                )}
              </CardContent>
            </Card>
          ) : (
            <>
              <p className='text-muted-foreground text-xs'>
                {page.count} knowledge
                {activeCategory ? ` dalam ${activeCategory.name}` : ''}
                {search ? ` untuk “${search}”` : ''}
              </p>
              <div className='grid gap-3 md:grid-cols-2'>
                {page.results.map((article) => (
                  <Link key={article.id} href={`/kms/${article.id}`} className='group' aria-label={article.title}>
                    <Card className='group-hover:border-ring h-full transition-colors'>
                      <CardContent className='flex h-full flex-col gap-2 p-4'>
                        <div className='flex items-start justify-between gap-2'>
                          <h2 className='group-hover:text-primary line-clamp-2 text-sm font-semibold'>
                            {article.title}
                          </h2>
                          {canManage && (
                            <span
                              className={cn(
                                'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium',
                                article.status === 'PUBLISHED' && 'bg-emerald-500/10 text-emerald-600',
                                article.status === 'DRAFT' && 'bg-muted text-muted-foreground',
                                article.status === 'ARCHIVED' && 'bg-amber-500/10 text-amber-600',
                              )}
                            >
                              {KMS_STATUS_LABELS[article.status]}
                            </span>
                          )}
                        </div>
                        <p className='text-muted-foreground line-clamp-2 text-xs'>
                          {article.summary || article.title}
                        </p>
                        <div className='mt-auto flex flex-wrap items-center gap-1.5 pt-1 text-[11px] text-muted-foreground'>
                          <span className='bg-muted rounded px-1.5 py-0.5'>
                            {article.category_name}
                          </span>
                          {article.subcategory_name && (
                            <span className='bg-muted rounded px-1.5 py-0.5'>
                              {article.subcategory_name}
                            </span>
                          )}
                          <span className='ml-auto flex items-center gap-1'>
                            <Icons.clock className='size-3' />
                            {formatDate(article.updated_at)}
                          </span>
                        </div>
                      </CardContent>
                    </Card>
                  </Link>
                ))}
              </div>
              {/* Pagination */}
              {(page.next || page.previous) && (
                <div className='flex items-center justify-end gap-2 pt-1'>
                  <Button
                    variant='outline'
                    size='sm'
                    disabled={!page.previous || loading}
                    onClick={() => loadPage((page?.next ? Number(new URL(page.next).searchParams.get('page')) : 1) - 1 || 1)}
                  >
                    Sebelumnya
                  </Button>
                  <Button
                    variant='outline'
                    size='sm'
                    disabled={!page.next || loading}
                    onClick={() => {
                      const u = page?.next ? new URL(page.next) : null;
                      loadPage(Number(u?.searchParams.get('page') ?? 1));
                    }}
                  >
                    Berikutnya
                  </Button>
                </div>
              )}
            </>
          )}
        </main>
      </div>

      {articleModal.open && (
        <ArticleFormModal
          article={articleModal.article}
          tree={tree}
          onClose={() => setArticleModal({ open: false, article: null })}
          onSaved={() => {
            setArticleModal({ open: false, article: null });
            load();
          }}
        />
      )}
      {categoryModal && (
        <CategoryManagerModal
          tree={tree}
          onClose={() => setCategoryModal(false)}
          onChanged={load}
        />
      )}
    </div>
  );
}
