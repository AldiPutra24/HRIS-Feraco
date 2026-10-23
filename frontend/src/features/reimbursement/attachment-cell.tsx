import { Icons } from '@/components/icons';
import type { Reimbursement } from '@/lib/reimbursements';

const LINK_CLASS = 'text-primary inline-flex items-center gap-1 text-xs font-medium hover:underline';

/**
 * Bukti Payment/Tagihan/Invoice: the uploaded file or the submitted link.
 * Same style as the izin/cuti attachment ("📎 Lampiran"); the original file
 * name / full URL shows on hover.
 */
export function AttachmentCell({ r }: { r: Pick<Reimbursement, 'attachment_url' | 'attachment_name' | 'attachment_link'> }) {
  if (r.attachment_url) {
    return (
      <a href={r.attachment_url} target='_blank' rel='noreferrer' title={r.attachment_name} className={LINK_CLASS}>
        <Icons.paperclip className='size-3.5' />
        Lampiran
      </a>
    );
  }
  if (r.attachment_link) {
    return (
      <a href={r.attachment_link} target='_blank' rel='noopener noreferrer' title={r.attachment_link} className={LINK_CLASS}>
        <Icons.link className='size-3.5' />
        Link
      </a>
    );
  }
  return <span className='text-muted-foreground text-xs'>-</span>;
}
