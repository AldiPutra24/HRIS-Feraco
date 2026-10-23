import { Button } from '@/components/ui/button';

/** "1–20 dari 57 data · Sebelumnya 1 / 3 Berikutnya" footer for paginated lists. */
export function ListPagination({
  page,
  pageSize,
  count,
  loading,
  onPage
}: {
  page: number;
  pageSize: number;
  count: number;
  loading?: boolean;
  onPage: (page: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(count / pageSize));
  return (
    <div className='flex items-center justify-between gap-2 border-t px-4 py-2 text-sm'>
      <span className='text-muted-foreground'>
        {count === 0 ? '0 data' : `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, count)} dari ${count} data`}
      </span>
      <div className='flex items-center gap-2'>
        <Button size='sm' variant='outline' disabled={loading || page <= 1} onClick={() => onPage(page - 1)}>
          Sebelumnya
        </Button>
        <span className='text-muted-foreground'>
          {page} / {totalPages}
        </span>
        <Button size='sm' variant='outline' disabled={loading || page >= totalPages} onClick={() => onPage(page + 1)}>
          Berikutnya
        </Button>
      </div>
    </div>
  );
}
