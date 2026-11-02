'use client';

/**
 * KMS main page — knowledge base, not an admin table.
 *
 * Layout: search hero ("Ada yang bisa kami bantu?") with topic chips, a
 * "Baru pakai HRIS?" starter row (when those articles exist), sticky
 * category navigation with per-user visible counts, and the article list.
 * KMS managers additionally get Kelola Kategori / Tambah Knowledge, a status
 * filter and status/visibility badges. Server-side filtering only
 * (?search= hits title/summary/content/category). Pagination via the shared
 * DRF PageNumberPagination.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { toast } from 'react-toastify';
import { Icons } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/lib/auth/auth-provider';
import {
  KMS_STATUS_LABELS,
  KMS_VISIBILITY_LABELS,
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

const ROLE_LABELS: Record<string, string> = {
  ADMIN: 'Admin',
  HR_LEAD: 'HR Lead',
  HR_STAFF: 'HR Staff',
  GENERAL_MANAGER: 'General Manager',
  MANAGEMENT: 'Management',
  EMPLOYEE: 'Employee',
};

// Quick searches under the hero.
const TOPICS = ['Cuti', 'Reimbursement'];

// "Baru pakai HRIS?" row: shown only for the starter articles that exist
// (matched by title, so HR can rename/remove them without code changes).
const STARTERS = [
  { match: 'mengenal hris', title: 'Mengenal HRIS FERACO', text: 'Fungsi sistem dan fitur yang dapat digunakan karyawan.' },
];

function visibilityLabel(article: KmsArticle): string {
  switch (article.visibility) {
    case 'ROLE':
      return `Role: ${article.role_targets.map((r) => ROLE_LABELS[r] ?? r).join(', ')}`;
    case 'DEPARTMENT':
      return 'Departemen Tertentu';
    case 'USER':
      return 'User Tertentu';
    case 'PRIVATE':
      return 'Private';
    default:
      return KMS_VISIBILITY_LABELS[article.visibility];
  }
}

function formatDate(iso: string | null): string {
  if (!iso) return '-';
  return new Date(iso).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
}

function CountBadge({ n, active }: { n: number; active?: boolean }) {
  return (
    <span
      className={cn(
        'min-w-6 rounded-full px-2 py-0.5 text-center text-xs font-semibold tabular-nums',
        active ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
      )}
    >
      {n}
    </span>
  );
}

export function KmsPage() {
  const { user } = useAuth();
  const canManage = KMS_ROLES.has(user?.role ?? '');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tree, setTree] = useState<KmsCategoryNode[]>([]);
  const [page, setPage] = useState<KmsPage<KmsArticle> | null>(null);
  const [pageNo, setPageNo] = useState(1);
  const [starters, setStarters] = useState<{ article: KmsArticle; title: string; text: string }[]>([]);

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
      setPageNo(1);
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

  const loadStarters = useCallback(async () => {
    const found = await Promise.all(
      STARTERS.map(async (s) => {
        const res = await listKmsArticles({ search: s.match }).catch(() => null);
        const article = res?.results.find((a) => a.status === 'PUBLISHED' && a.title.toLowerCase().includes(s.match));
        return article ? { article, title: s.title, text: s.text } : null;
      }),
    );
    setStarters(found.filter((x): x is NonNullable<typeof x> => x !== null));
  }, []);

  useEffect(() => {
    loadStarters();
  }, [loadStarters]);

  function loadPage(next: number) {
    setLoading(true);
    listKmsArticles({
      search: search || undefined,
      category: category ?? undefined,
      subcategory: subcategory ?? undefined,
      status: status || undefined,
      page: next,
    })
      .then((p) => {
        setPage(p);
        setPageNo(next);
      })
      .catch((err) => toast.error(err instanceof Error ? err.message : 'Gagal memuat halaman.'))
      .finally(() => setLoading(false));
  }

  const activeCategory = useMemo(() => tree.find((n) => n.id === category) ?? null, [tree, category]);
  const activeSub = activeCategory?.children.find((c) => c.id === subcategory) ?? null;
  const totalVisible = tree.reduce((sum, n) => sum + (n.visible_count ?? 0), 0);

  function pickCategory(id: number | null) {
    setCategory(id);
    setSubcategory(null);
  }

  function runSearch(q: string) {
    setSearchInput(q);
    setSearch(q.trim());
  }

  const hasFilters = search !== '' || category !== null || subcategory !== null || status !== '';
  const listTitle = search
    ? `Hasil untuk “${search}”`
    : activeSub
      ? activeSub.name
      : activeCategory
        ? activeCategory.name
        : 'Semua artikel';

  return (
    <div className='flex flex-1 flex-col gap-6 p-4 md:p-8'>
      {canManage && (
        <div className='flex flex-wrap items-center justify-end gap-2'>
          <Button variant='outline' onClick={() => setCategoryModal(true)}>
            <Icons.folder className='size-4' />
            Kelola Kategori
          </Button>
          <Button onClick={() => setArticleModal({ open: true, article: null })}>
            <Icons.add className='size-4' />
            Tambah Knowledge
          </Button>
        </div>
      )}

      {/* Search hero */}
      <Card className='items-center gap-0 px-6 py-12 text-center'>
        <span className='bg-primary/10 text-primary flex size-14 items-center justify-center rounded-2xl'>
          <Icons.books className='size-6' />
        </span>
        <h1 className='mt-5 text-3xl font-bold tracking-tight md:text-4xl'>Ada yang bisa kami bantu?</h1>
        <p className='text-muted-foreground mt-2'>Panduan, SOP, dan informasi internal FERACO di satu tempat.</p>
        <form
          className='relative mt-6 w-full max-w-2xl'
          onSubmit={(e) => {
            e.preventDefault();
            runSearch(searchInput);
          }}
        >
          <Icons.search className='text-muted-foreground pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2' />
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder='Cari judul, ringkasan, isi, kategori…'
            aria-label='Cari knowledge'
            className='border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 h-14 w-full rounded-xl border pr-24 pl-12 text-base outline-none focus-visible:ring-3'
          />
          {searchInput && (
            <button
              type='button'
              onClick={() => runSearch('')}
              className='text-muted-foreground hover:text-foreground absolute top-1/2 right-4 -translate-y-1/2 text-sm'
            >
              Hapus
            </button>
          )}
        </form>
        <div className='mt-4 flex flex-wrap items-center justify-center gap-2 text-sm'>
          <span className='text-muted-foreground'>Topik populer:</span>
          {TOPICS.map((t) => (
            <button
              key={t}
              type='button'
              onClick={() => runSearch(t)}
              className={cn(
                'rounded-full border px-3.5 py-1.5 transition-colors',
                search.toLowerCase() === t.toLowerCase() ? 'bg-foreground text-background border-foreground' : 'hover:bg-muted',
              )}
            >
              {t}
            </button>
          ))}
        </div>
      </Card>

      {/* Starter guides */}
      {starters.length > 0 && !hasFilters && (
        <section className='space-y-3'>
          <h2 className='font-semibold'>Baru pakai HRIS? Mulai di sini</h2>
          <div className={cn('grid gap-4', starters.length > 1 && 'md:grid-cols-2')}>
            {starters.map((s, i) => (
              <Link
                key={s.article.id}
                href={`/kms/${s.article.id}`}
                className={cn(
                  'flex items-center gap-4 rounded-xl border px-5 py-5 transition-colors',
                  i === 0 ? 'bg-primary text-primary-foreground border-primary hover:bg-primary/90' : 'bg-card hover:bg-muted/40',
                )}
              >
                <span
                  className={cn(
                    'flex size-10 shrink-0 items-center justify-center rounded-lg font-semibold',
                    i === 0 ? 'bg-white/15' : 'bg-primary/10 text-primary',
                  )}
                >
                  {i + 1}
                </span>
                <span className='min-w-0'>
                  <span className='block font-semibold'>{s.title}</span>
                  <span className={cn('block text-sm', i === 0 ? 'opacity-90' : 'text-muted-foreground')}>{s.text}</span>
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      <div className='grid gap-6 lg:grid-cols-[240px_1fr]'>
        {/* Category navigation */}
        <aside className='lg:sticky lg:top-20 lg:self-start'>
          <p className='text-muted-foreground mb-2 px-3 font-mono text-xs tracking-widest uppercase'>Kategori</p>
          <nav className='space-y-1'>
            <button
              type='button'
              onClick={() => pickCategory(null)}
              className={cn(
                'flex w-full items-center gap-2 rounded-xl border px-3 py-2.5 text-left text-sm transition-colors',
                category === null ? 'bg-card font-semibold shadow-xs' : 'hover:bg-muted border-transparent',
              )}
            >
              <span className='flex-1'>Semua</span>
              <CountBadge n={totalVisible} active={category === null} />
            </button>
            {tree.map((node) => (
              <div key={node.id}>
                <button
                  type='button'
                  onClick={() => pickCategory(node.id)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-xl border px-3 py-2.5 text-left text-sm transition-colors',
                    category === node.id && subcategory === null
                      ? 'bg-card font-semibold shadow-xs'
                      : 'hover:bg-muted border-transparent',
                  )}
                >
                  <span className='flex-1 truncate'>{node.name}</span>
                  <CountBadge n={node.visible_count ?? 0} active={category === node.id && subcategory === null} />
                </button>
                {category === node.id && node.children.length > 0 && (
                  <div className='mt-1 ml-4 space-y-0.5 border-l pl-2'>
                    {node.children.map((child) => (
                      <button
                        key={child.id}
                        type='button'
                        onClick={() => {
                          setCategory(node.id);
                          setSubcategory(child.id);
                        }}
                        className={cn(
                          'text-muted-foreground hover:bg-muted flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm',
                          subcategory === child.id && 'bg-muted text-foreground font-medium',
                        )}
                      >
                        <span className='flex-1 truncate'>{child.name}</span>
                        <span className='text-xs tabular-nums'>{child.visible_count ?? 0}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </nav>
        </aside>

        {/* Articles */}
        <Card className='gap-0 overflow-hidden py-0'>
          <div className='flex flex-wrap items-center justify-between gap-3 px-6 py-5'>
            <h2 className='text-lg font-semibold'>{listTitle}</h2>
            <div className='flex flex-wrap items-center gap-2'>
              {canManage && (
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as KmsStatus | '')}
                  className='bg-background h-9 rounded-lg border px-2 text-sm'
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
                    runSearch('');
                    pickCategory(null);
                    setStatus('');
                  }}
                >
                  <Icons.close className='size-4' />
                  Reset
                </Button>
              )}
              {page && <span className='text-muted-foreground text-sm'>{page.count} artikel</span>}
            </div>
          </div>

          <div className='border-t'>
            {loading && !page ? (
              <div className='space-y-3 px-6 py-5'>
                {[1, 2, 3, 4].map((i) => (
                  <Skeleton key={i} className='h-16 w-full rounded-xl' />
                ))}
              </div>
            ) : error ? (
              <div className='flex flex-col items-center gap-3 px-6 py-12 text-center'>
                <Icons.circleX className='text-destructive size-8' />
                <p className='text-sm font-medium'>Gagal memuat knowledge</p>
                <p className='text-muted-foreground text-xs'>{error}</p>
                <Button variant='outline' size='sm' onClick={load}>
                  <Icons.refresh className='size-4' />
                  Coba lagi
                </Button>
              </div>
            ) : !page || page.results.length === 0 ? (
              <div className='flex flex-col items-center gap-3 px-6 py-12 text-center'>
                <Icons.books className='text-muted-foreground/50 size-10' />
                <p className='text-sm font-medium'>{hasFilters ? 'Tidak ada knowledge yang cocok.' : 'Belum ada knowledge.'}</p>
                <p className='text-muted-foreground max-w-sm text-sm'>
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
              </div>
            ) : (
              <ul className={cn('divide-y', loading && 'opacity-60')}>
                {page.results.map((article) => (
                  <li key={article.id}>
                    <Link
                      href={`/kms/${article.id}`}
                      className='group hover:bg-muted/40 flex items-center gap-4 px-6 py-5 transition-colors'
                    >
                      <span className='bg-muted text-muted-foreground flex size-11 shrink-0 items-center justify-center self-start rounded-xl'>
                        <Icons.page className='size-5' />
                      </span>
                      <div className='min-w-0 flex-1'>
                        <div className='flex flex-wrap items-center gap-2'>
                          <h3 className='group-hover:text-primary font-semibold'>{article.title}</h3>
                          {canManage && article.status !== 'PUBLISHED' && (
                            <span
                              className={cn(
                                'rounded-full px-2 py-0.5 text-[11px] font-medium',
                                article.status === 'DRAFT' && 'bg-muted text-muted-foreground',
                                article.status === 'ARCHIVED' && 'bg-amber-500/10 text-amber-700',
                              )}
                            >
                              {KMS_STATUS_LABELS[article.status]}
                            </span>
                          )}
                        </div>
                        {article.summary && (
                          <p className='text-muted-foreground mt-1 line-clamp-2 text-sm'>{article.summary}</p>
                        )}
                        <div className='text-muted-foreground mt-2 flex flex-wrap items-center gap-1.5 text-xs'>
                          <span className='bg-primary/10 text-primary rounded px-2 py-0.5 font-medium'>{article.category_name}</span>
                          {article.subcategory_name && (
                            <span className='bg-muted text-foreground rounded px-2 py-0.5'>{article.subcategory_name}</span>
                          )}
                          {canManage && article.visibility !== 'ALL' && (
                            <span className='bg-muted rounded px-2 py-0.5'>{visibilityLabel(article)}</span>
                          )}
                          <span>· Diperbarui {formatDate(article.updated_at)}</span>
                        </div>
                      </div>
                      <Icons.chevronRight className='text-muted-foreground size-5 shrink-0' />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {page && (page.next || page.previous) && (
            <div className='flex items-center justify-end gap-2 border-t px-6 py-3.5'>
              <Button variant='outline' size='sm' disabled={!page.previous || loading} onClick={() => loadPage(pageNo - 1)}>
                Sebelumnya
              </Button>
              <span className='text-muted-foreground text-sm tabular-nums'>Hal. {pageNo}</span>
              <Button variant='outline' size='sm' disabled={!page.next || loading} onClick={() => loadPage(pageNo + 1)}>
                Berikutnya
              </Button>
            </div>
          )}
        </Card>
      </div>

      {articleModal.open && (
        <ArticleFormModal
          article={articleModal.article}
          tree={tree}
          onClose={() => setArticleModal({ open: false, article: null })}
          onSaved={() => {
            setArticleModal({ open: false, article: null });
            load();
            loadStarters();
          }}
        />
      )}
      {categoryModal && (
        <CategoryManagerModal tree={tree} onClose={() => setCategoryModal(false)} onChanged={load} />
      )}
    </div>
  );
}
