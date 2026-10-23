// http(s) URLs only — other schemes (javascript:, data:) stay plain text.
const URL_RE = /(https?:\/\/[^\s<>"']+)/g;
// Punctuation that usually ends a sentence, not the URL.
const TRAILING_RE = /[.,;:!?)\]]+$/;

/**
 * Plain text with http(s) URLs rendered as links (new tab). Text is never
 * parsed as HTML, so user input cannot inject markup.
 */
export function LinkifiedText({ text, className }: { text: string; className?: string }) {
  const parts = text.split(URL_RE);
  return (
    <span className={className}>
      {parts.map((part, i) => {
        if (i % 2 === 0) return part;
        const trailing = part.match(TRAILING_RE)?.[0] ?? '';
        const url = trailing ? part.slice(0, -trailing.length) : part;
        return (
          <span key={i}>
            <a
              href={url}
              target='_blank'
              rel='noopener noreferrer'
              className='text-primary break-all underline underline-offset-2'
            >
              {url}
            </a>
            {trailing}
          </span>
        );
      })}
    </span>
  );
}
