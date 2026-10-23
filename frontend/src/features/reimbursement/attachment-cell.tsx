import type { Reimbursement } from '@/lib/reimbursements';

/** Bukti Payment/Tagihan/Invoice: the uploaded file or the submitted link. */
export function AttachmentCell({ r }: { r: Pick<Reimbursement, 'attachment_url' | 'attachment_name' | 'attachment_link'> }) {
  if (r.attachment_url) {
    return (
      <a href={r.attachment_url} target='_blank' rel='noreferrer' className='text-primary underline'>
        {r.attachment_name}
      </a>
    );
  }
  if (r.attachment_link) {
    return (
      <a
        href={r.attachment_link}
        target='_blank'
        rel='noopener noreferrer'
        title={r.attachment_link}
        className='text-primary underline'
      >
        Buka link
      </a>
    );
  }
  return <span className='text-muted-foreground'>-</span>;
}
