'use client';

/**
 * Rich-text email body editor (contentEditable, no external deps).
 *
 * - Toolbar commands use document.execCommand (browser-built-in) so the
 *   produced HTML stays email-safe (p/strong/em/u/s/a/ul/ol/blockquote/font).
 * - Placeholder buttons insert the token at the LAST caret position inside
 *   the editor: the selection is saved continuously (selectionchange) and
 *   restored before inserting, because clicking a button moves focus out of
 *   the contentEditable. If no saved selection exists, the caret is placed
 *   at a sensible default (end of content).
 * - The token is inserted as a plain-text node via insertText, so it never
 *   becomes a custom element and always stays `{{placeholder}}` text in the
 *   stored HTML.
 * - Paste is forced to plain text; hyperlink URLs are validated
 *   (http/https/mailto/tel only) and get rel=noopener noreferrer.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Icons } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Placeholder labels — human-friendly chip text, tooltip shows the raw token.
// ---------------------------------------------------------------------------

const PLACEHOLDER_LABELS: Record<string, string> = {
  '{{employee_name}}': 'Employee Name',
  '{{employee_email}}': 'Employee Email',
  '{{manager_name}}': 'Manager Name',
  '{{manager_email}}': 'Manager Email',
  '{{contract_end_date}}': 'Contract End Date',
  '{{days_remaining}}': 'Days Remaining',
  '{{leave_type}}': 'Leave Type',
  '{{leave_start}}': 'Leave Start',
  '{{leave_end}}': 'Leave End',
  '{{leave_status}}': 'Leave Status',
  '{{rejection_reason}}': 'Rejection Reason',
};

function placeholderLabel(token: string): string {
  return PLACEHOLDER_LABELS[token] ?? token.replace(/[{}]/g, '').replace(/_/g, ' ');
}

function isSafeUrl(raw: string): boolean {
  const url = raw.trim();
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return ['http:', 'https:', 'mailto:', 'tel:'].includes(parsed.protocol);
  } catch {
    return false;
  }
}

/** Convert plain-text (legacy) template into editor-safe HTML. */
function toEditorHtml(raw: string): string {
  const text = (raw ?? '').trim();
  if (!text) return '';
  if (/<[a-z][\s\S]*>/i.test(text)) return text; // already HTML
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return escaped
    .split(/\n{2,}/)
    .map((para) => `<p>${para.replace(/\n/g, '<br>')}</p>`)
    .join('');
}

function normalizeHtml(html: string): string {
  return html.replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// Toolbar building blocks (module scope: no per-render re-creation).
// ---------------------------------------------------------------------------

function ToolButton({
  icon,
  label,
  active,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type='button'
      title={label}
      aria-label={label}
      aria-pressed={active}
      onMouseDown={(e) => e.preventDefault()} // keep editor selection
      onClick={onClick}
      className={cn(
        'hover:bg-muted inline-flex h-7 min-w-7 items-center justify-center gap-1 rounded-md px-1.5 text-sm transition-colors',
        active && 'bg-muted text-foreground',
      )}
    >
      {icon}
    </button>
  );
}

function Divider() {
  return <span className='bg-border mx-0.5 h-5 w-px shrink-0' aria-hidden />;
}

function DropdownShell({
  open,
  onToggle,
  label,
  icon,
  text,
  children,
  widthClass,
}: {
  open: boolean;
  onToggle: () => void;
  label: string;
  icon?: ReactNode;
  text?: string;
  children: ReactNode;
  widthClass?: string;
}) {
  return (
    <span className='relative inline-flex'>
      <button
        type='button'
        title={label}
        aria-label={label}
        aria-expanded={open}
        onMouseDown={(e) => e.preventDefault()}
        onClick={onToggle}
        className={cn(
          'hover:bg-muted inline-flex h-7 items-center justify-center gap-1 rounded-md px-1.5 text-xs transition-colors',
          open && 'bg-muted text-foreground',
        )}
      >
        {icon}
        {text && <span className='max-w-20 truncate'>{text}</span>}
        <Icons.caretDown className='size-3 opacity-60' />
      </button>
      {open && (
        <div
          className={cn(
            'bg-popover absolute top-8 left-0 z-50 rounded-lg border p-1 shadow-md',
            widthClass ?? 'w-44',
          )}
        >
          {children}
        </div>
      )}
    </span>
  );
}

function MenuItem({
  label,
  active,
  onClick,
  swatch,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  swatch?: string;
}) {
  return (
    <button
      type='button'
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={cn(
        'hover:bg-muted flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs',
        active && 'bg-muted font-medium',
      )}
    >
      {swatch && <span className='size-3 shrink-0 rounded-full border' style={{ background: swatch }} />}
      {label}
    </button>
  );
}

const FONT_FAMILIES = [
  { label: 'Arial', value: 'Arial, Helvetica, sans-serif' },
  { label: 'Verdana', value: 'Verdana, Geneva, sans-serif' },
  { label: 'Tahoma', value: 'Tahoma, sans-serif' },
  { label: 'Trebuchet MS', value: "'Trebuchet MS', sans-serif" },
  { label: 'Times New Roman', value: "'Times New Roman', Times, serif" },
  { label: 'Georgia', value: 'Georgia, serif' },
  { label: 'Courier New', value: "'Courier New', Courier, monospace" },
];

// Legacy 1-7 scale: browsers map it to email-safe <font size="n">.
const FONT_SIZES = [
  { label: 'Kecil', value: '2' },
  { label: 'Normal', value: '3' },
  { label: 'Besar', value: '4' },
  { label: 'Sangat Besar', value: '5' },
  { label: 'Judul', value: '6' },
];

const TEXT_COLORS = [
  '#0f172a', '#475569', '#dc2626', '#ea580c', '#d97706',
  '#16a34a', '#0d9488', '#2563eb', '#7c3aed', '#db2777',
];

const HEADING_LEVELS = [
  { label: 'Teks', tag: 'p' },
  { label: 'Judul 1', tag: 'h1' },
  { label: 'Judul 2', tag: 'h2' },
  { label: 'Judul 3', tag: 'h3' },
];

type Props = {
  value: string;
  onChange: (html: string) => void;
  placeholders: string[];
  id?: string;
};

export function EmailBodyEditor({ value, onChange, placeholders, id }: Props) {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  // Last caret/selection INSIDE the editor. Kept in a ref (not state) so the
  // placeholder click handler always has the freshest range even though the
  // click itself blurred the editor.
  const savedRange = useRef<Range | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [linkHasSelection, setLinkHasSelection] = useState(false);
  const [activeFormats, setActiveFormats] = useState<Record<string, boolean>>({});
  const [fontOpen, setFontOpen] = useState(false);
  const [sizeOpen, setSizeOpen] = useState(false);
  const [colorOpen, setColorOpen] = useState(false);
  const [headingOpen, setHeadingOpen] = useState(false);

  /** Editor DOM -> stored HTML string (normalized). */
  const readEditorHtml = useCallback((): string => {
    const el = editorRef.current;
    if (!el) return '';
    const html = el.innerHTML ?? '';
    if (html === '<br>' || html === '<div><br></div>') return '';
    return html;
  }, []);

  const pushChange = useCallback(() => {
    onChange(readEditorHtml());
  }, [onChange, readEditorHtml]);

  // ---------------------------------------------------------------------
  // Selection management.
  // ---------------------------------------------------------------------

  const saveSelection = useCallback(() => {
    const sel = window.getSelection();
    const el = editorRef.current;
    if (!sel || !el || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    if (el.contains(range.commonAncestorContainer)) {
      savedRange.current = range.cloneRange();
    }
  }, []);

  useEffect(() => {
    const handler = () => saveSelection();
    document.addEventListener('selectionchange', handler);
    return () => document.removeEventListener('selectionchange', handler);
  }, [saveSelection]);

  /** Restore the last editor caret (or focus the editor at a default spot). */
  const restoreSelection = useCallback((): boolean => {
    const el = editorRef.current;
    if (!el) return false;
    const sel = window.getSelection();
    if (!sel) return false;
    if (savedRange.current && el.contains(savedRange.current.startContainer)) {
      sel.removeAllRanges();
      sel.addRange(savedRange.current);
      return true;
    }
    // No previous caret: default to the end of the content.
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
    return true;
  }, []);

  const refreshFormats = useCallback(() => {
    if (!editorRef.current) return;
    try {
      setActiveFormats({
        bold: document.queryCommandState('bold'),
        italic: document.queryCommandState('italic'),
        underline: document.queryCommandState('underline'),
        strikeThrough: document.queryCommandState('strikeThrough'),
        insertUnorderedList: document.queryCommandState('insertUnorderedList'),
        insertOrderedList: document.queryCommandState('insertOrderedList'),
        justifyLeft: document.queryCommandState('justifyLeft'),
        justifyCenter: document.queryCommandState('justifyCenter'),
        justifyRight: document.queryCommandState('justifyRight'),
      });
    } catch {
      // queryCommandState can throw on odd selections; ignore.
    }
  }, []);

  /** Run a document.execCommand on the editor's current/last selection. */
  const exec = useCallback(
    (command: string, arg?: string) => {
      const el = editorRef.current;
      if (!el) return;
      el.focus();
      restoreSelection();
      document.execCommand(command, false, arg);
      saveSelection();
      refreshFormats();
      pushChange();
    },
    [restoreSelection, saveSelection, refreshFormats, pushChange],
  );

  // ---------------------------------------------------------------------
  // Placeholder insertion at the saved caret.
  // ---------------------------------------------------------------------

  const insertPlaceholder = useCallback(
    (token: string) => {
      const el = editorRef.current;
      if (!el) return;
      el.focus();
      restoreSelection();
      const ok = document.execCommand('insertText', false, token);
      if (!ok) {
        // Fallback for engines without insertText: manual range insert.
        const sel = window.getSelection();
        if (sel && sel.rangeCount > 0) {
          const range = sel.getRangeAt(0);
          range.deleteContents();
          range.insertNode(document.createTextNode(token));
          range.collapse(false);
          sel.removeAllRanges();
          sel.addRange(range);
        }
      }
      // Caret now sits right after the inserted token; persist it so the
      // next placeholder insert lands adjacent to this one.
      saveSelection();
      pushChange();
    },
    [restoreSelection, saveSelection, pushChange],
  );

  // ---------------------------------------------------------------------
  // Hyperlink handling (insert / update / remove, validated URL).
  // ---------------------------------------------------------------------

  const openLinkDialog = useCallback(() => {
    const el = editorRef.current;
    if (!el) return;
    el.focus();
    restoreSelection();
    const sel = window.getSelection();
    const hasSelection = !!sel && sel.rangeCount > 0 && !sel.isCollapsed;
    setLinkHasSelection(hasSelection);
    // Pre-fill from an existing link under the caret/selection.
    let current = '';
    let node: Node | null = sel && sel.rangeCount > 0 ? sel.getRangeAt(0).startContainer : null;
    while (node && node !== el) {
      if (node instanceof HTMLAnchorElement) {
        current = node.getAttribute('href') ?? '';
        break;
      }
      node = node.parentNode;
    }
    setLinkUrl(current);
    setLinkOpen(true);
  }, [restoreSelection]);

  const applyLink = useCallback(() => {
    const raw = linkUrl.trim();
    if (!raw || !isSafeUrl(raw)) return;
    exec('createLink', raw);
    // Email best practice: open in a new tab, never leak referrer.
    const el = editorRef.current;
    if (el) {
      for (const a of Array.from(el.querySelectorAll('a'))) {
        a.setAttribute('target', '_blank');
        a.setAttribute('rel', 'noopener noreferrer');
      }
    }
    pushChange();
    setLinkOpen(false);
    setLinkUrl('');
  }, [linkUrl, exec, pushChange]);

  const removeLink = useCallback(() => {
    exec('unlink');
    setLinkOpen(false);
    setLinkUrl('');
  }, [exec]);

  // ---------------------------------------------------------------------
  // Close any open dropdown when clicking outside the toolbar.
  // ---------------------------------------------------------------------

  useEffect(() => {
    if (!(fontOpen || sizeOpen || colorOpen || headingOpen)) return;
    const handler = (e: MouseEvent) => {
      if (toolbarRef.current && e.target instanceof Node && !toolbarRef.current.contains(e.target)) {
        setFontOpen(false);
        setSizeOpen(false);
        setColorOpen(false);
        setHeadingOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [fontOpen, sizeOpen, colorOpen, headingOpen]);

  // ---------------------------------------------------------------------
  // Sync external value -> editor content (only when it really changed
  // externally, so the caret is not reset while typing).
  // ---------------------------------------------------------------------

  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    const incoming = toEditorHtml(value);
    if (normalizeHtml(incoming) !== normalizeHtml(el.innerHTML ?? '')) {
      el.innerHTML = incoming;
      savedRange.current = null;
    }
  }, [value]);

  // ---------------------------------------------------------------------
  // Toolbar render helpers.
  // ---------------------------------------------------------------------

  function closeMenus() {
    setFontOpen(false);
    setSizeOpen(false);
    setColorOpen(false);
    setHeadingOpen(false);
  }

  const hasContent = value.replace(/<[^>]+>/g, '').trim().length > 0;

  return (
    <div className='space-y-2'>
      {/* Toolbar */}
      <div
        ref={toolbarRef}
        className='bg-background flex flex-wrap items-center gap-0.5 rounded-xl border p-1'
        role='toolbar'
        aria-label='Format teks email'
      >
        <ToolButton icon={<Icons.undo className='size-4' />} label='Urungkan (Undo)' onClick={() => exec('undo')} />
        <ToolButton icon={<Icons.redo className='size-4' />} label='Ulangi (Redo)' onClick={() => exec('redo')} />
        <Divider />

        {/* Paragraph style */}
        <DropdownShell
          open={headingOpen}
          onToggle={() => {
            closeMenus();
            setHeadingOpen(true);
          }}
          label='Gaya paragraf'
          text={HEADING_LEVELS[0].label}
          widthClass='w-40'
        >
          {HEADING_LEVELS.map((h) => (
            <MenuItem
              key={h.tag}
              label={h.label}
              onClick={() => {
                closeMenus();
                exec('formatBlock', `<${h.tag}>`);
              }}
            />
          ))}
        </DropdownShell>

        {/* Font family */}
        <DropdownShell
          open={fontOpen}
          onToggle={() => {
            closeMenus();
            setFontOpen(true);
          }}
          label='Jenis huruf'
          text='Font'
          widthClass='w-48'
        >
          {FONT_FAMILIES.map((f) => (
            <MenuItem
              key={f.value}
              label={f.label}
              onClick={() => {
                closeMenus();
                exec('fontName', f.value);
              }}
            />
          ))}
        </DropdownShell>

        {/* Font size */}
        <DropdownShell
          open={sizeOpen}
          onToggle={() => {
            closeMenus();
            setSizeOpen(true);
          }}
          label='Ukuran huruf'
          text='Ukuran'
          widthClass='w-40'
        >
          {FONT_SIZES.map((s) => (
            <MenuItem
              key={s.value}
              label={s.label}
              onClick={() => {
                closeMenus();
                exec('fontSize', s.value);
              }}
            />
          ))}
        </DropdownShell>

        <Divider />
        <ToolButton icon={<Icons.bold className='size-4' />} label='Tebal (Bold)' active={activeFormats.bold} onClick={() => exec('bold')} />
        <ToolButton icon={<Icons.italic className='size-4' />} label='Miring (Italic)' active={activeFormats.italic} onClick={() => exec('italic')} />
        <ToolButton icon={<Icons.underline className='size-4' />} label='Garis Bawah (Underline)' active={activeFormats.underline} onClick={() => exec('underline')} />
        <ToolButton icon={<Icons.strikeThrough className='size-4' />} label='Coret (Strikethrough)' active={activeFormats.strikeThrough} onClick={() => exec('strikeThrough')} />

        {/* Text color */}
        <DropdownShell
          open={colorOpen}
          onToggle={() => {
            closeMenus();
            setColorOpen(true);
          }}
          label='Warna teks'
          icon={<Icons.textColor className='size-4' />}
          widthClass='w-44'
        >
          <div className='grid grid-cols-5 gap-1 p-1'>
            {TEXT_COLORS.map((color) => (
              <button
                key={color}
                type='button'
                aria-label={`Warna ${color}`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  closeMenus();
                  exec('foreColor', color);
                }}
                className='hover:ring-ring size-5 rounded-full border transition-shadow hover:ring-2'
                style={{ background: color }}
              />
            ))}
          </div>
        </DropdownShell>

        <Divider />
        <ToolButton icon={<Icons.alignLeft className='size-4' />} label='Rata Kiri' active={activeFormats.justifyLeft} onClick={() => exec('justifyLeft')} />
        <ToolButton icon={<Icons.alignCenter className='size-4' />} label='Rata Tengah' active={activeFormats.justifyCenter} onClick={() => exec('justifyCenter')} />
        <ToolButton icon={<Icons.alignRight className='size-4' />} label='Rata Kanan' active={activeFormats.justifyRight} onClick={() => exec('justifyRight')} />

        <Divider />
        <ToolButton icon={<Icons.orderedList className='size-4' />} label='Daftar Bernomor' active={activeFormats.insertOrderedList} onClick={() => exec('insertOrderedList')} />
        <ToolButton icon={<Icons.bulletList className='size-4' />} label='Daftar Poin' active={activeFormats.insertUnorderedList} onClick={() => exec('insertUnorderedList')} />
        <ToolButton icon={<Icons.indent className='size-4' />} label='Majukan (Indent)' onClick={() => exec('indent')} />
        <ToolButton icon={<Icons.outdent className='size-4' />} label='Mundukan (Outdent)' onClick={() => exec('outdent')} />

        <Divider />
        <ToolButton icon={<Icons.blockquote className='size-4' />} label='Kutipan (Blockquote)' onClick={() => exec('formatBlock', '<blockquote>')} />
        <ToolButton icon={<Icons.link className='size-4' />} label='Sisipkan / Ubah Tautan' onClick={openLinkDialog} />
        <ToolButton icon={<Icons.unlink className='size-4' />} label='Hapus Tautan' onClick={removeLink} />
        <ToolButton icon={<Icons.clearFormatting className='size-4' />} label='Hapus Format' onClick={() => exec('removeFormat')} />
      </div>

      {/* Editable area */}
      <div
        id={id}
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        role='textbox'
        aria-multiline='true'
        aria-label='Isi email'
        data-placeholder={hasContent ? undefined : 'Isi Text...'}
        className='bg-background min-h-40 w-full overflow-auto rounded-xl border px-3 py-2 text-sm leading-relaxed outline-none [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2 [&_blockquote]:border-l-4 [&_blockquote]:border-l-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground [&_blockquote]:italic [&_h1]:text-xl [&_h1]:font-bold [&_h2]:text-lg [&_h2]:font-bold [&_h3]:text-base [&_h3]:font-semibold [&_ol]:list-decimal [&_ol]:pl-6 [&_ul]:list-disc [&_ul]:pl-6 [&[data-placeholder]:empty]:before:text-muted-foreground [&[data-placeholder]:empty]:before:content-[attr(data-placeholder)] focus:ring-ring/50 focus:ring-2'
        tabIndex={0}
        style={{ wordBreak: 'break-word' }}
        onInput={pushChange}
        onBlur={saveSelection}
        onKeyUp={refreshFormats}
        onMouseUp={refreshFormats}
        onPaste={(e) => {
          // Paste as plain text: external rich HTML is never trusted.
          e.preventDefault();
          const text = e.clipboardData.getData('text/plain');
          document.execCommand('insertText', false, text);
          pushChange();
        }}
      />

      {/* Hyperlink dialog */}
      {linkOpen && (
        <div className='bg-background/60 fixed inset-0 z-50 flex items-center justify-center p-4'>
          <div className='bg-background w-full max-w-md rounded-xl border p-4 shadow-lg'>
            <p className='mb-3 text-sm font-semibold'>Tautan (Hyperlink)</p>
            <div className='space-y-3'>
              <div>
                <Label className='mb-1 block text-xs' htmlFor='email-link-url'>
                  URL
                </Label>
                <Input
                  id='email-link-url'
                  value={linkUrl}
                  onChange={(e) => setLinkUrl(e.target.value)}
                  placeholder='https://feraco.co.id'
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') applyLink();
                    if (e.key === 'Escape') setLinkOpen(false);
                  }}
                />
                {linkUrl.trim() !== '' && !isSafeUrl(linkUrl.trim()) && (
                  <p className='text-destructive mt-1 text-xs'>
                    URL harus diawali http://, https://, mailto:, atau tel:
                  </p>
                )}
                {!linkHasSelection && (
                  <p className='text-muted-foreground mt-1 text-xs'>
                    Tidak ada teks yang dipilih — tautan akan disisipkan di posisi kursor.
                  </p>
                )}
              </div>
              <div className='flex justify-end gap-2'>
                {linkUrl.trim() !== '' && (
                  <Button variant='outline' onClick={removeLink}>
                    Hapus Tautan
                  </Button>
                )}
                <Button variant='outline' onClick={() => setLinkOpen(false)}>
                  Batal
                </Button>
                <Button onClick={applyLink} disabled={!isSafeUrl(linkUrl.trim())}>
                  Simpan Tautan
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Placeholder chips */}
      {placeholders.length > 0 && (
        <div className='text-muted-foreground text-xs'>
          <p className='mb-1 font-medium'>
            Placeholder — klik untuk sisipkan di posisi kursor:
          </p>
          <div className='flex flex-wrap gap-1'>
            {placeholders.map((p) => (
              <button
                key={p}
                type='button'
                title={p}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => insertPlaceholder(p)}
                className='bg-muted hover:bg-accent rounded px-1.5 py-0.5 font-mono text-[10px] transition-colors'
              >
                {placeholderLabel(p)}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
