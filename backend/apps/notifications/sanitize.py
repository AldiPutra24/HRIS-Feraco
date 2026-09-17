"""HTML sanitizer for rich-text email templates.

Whitelist-based: only known-safe tags/attributes/CSS properties survive.
Anything that could enable XSS is removed — <script>/<style>/<iframe> are
dropped with their content, event-handler attributes (onclick etc.) and
javascript:/data:/vbscript: URLs are stripped, and every tag outside the
whitelist is unwrapped (its text content is kept, the tag is not).

Used in three places (see emails.py / services.py):
- when an editor HTML body is saved (serializer validation)
- just before an HTML email is sent (defense in depth)
- when deriving the plain-text fallback from an HTML body
"""
import html
import re
from html.parser import HTMLParser

# Formatting whitelist — matches what the EmailBodyEditor toolbar can produce.
# <font> is kept because browsers emit <font size/color/face> for the classic
# execCommand fontSize/fontName formatting; it is the email-safe legacy tag.
ALLOWED_TAGS = frozenset({
    'p', 'br', 'div', 'span', 'font',
    'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'del',
    'ul', 'ol', 'li',
    'blockquote', 'a',
})

# Attributes kept per tag (class/style kept because the editor uses inline
# styles for font family/size/color/alignment; the style *values* are
# filtered again below against ALLOWED_STYLES).
ALLOWED_ATTRS = {
    'a': {'href', 'title', 'target', 'rel'},
    'p': {'style', 'dir'},
    'div': {'style', 'dir'},
    'span': {'style'},
    'ul': {'style'},
    'ol': {'style'},
    'li': {'style'},
    'blockquote': {'style'},
    'font': {'color', 'face', 'size'},
}

ALLOWED_STYLES = frozenset({
    'color', 'background-color', 'font-family', 'font-size',
    'text-align', 'font-weight', 'font-style', 'text-decoration',
})

# URL schemes allowed in href. Everything else (javascript:, data:,
# vbscript:, file:, ...) is stripped.
ALLOWED_URL_SCHEMES = ('http:', 'https:', 'mailto:', 'tel:')

# Tags removed together with their entire content.
DROP_WITH_CONTENT = frozenset({
    'script', 'style', 'iframe', 'object', 'embed', 'noscript', 'title',
    'head', 'svg', 'math',
})

_EVENT_ATTR_RE = re.compile(r'^\s*on', re.IGNORECASE)
_WS_RE = re.compile(r'[ \t\r\f\v]+')


def _safe_url(value: str) -> str:
    """Return a sanitized URL, or '' if the scheme is not allowed."""
    url = (value or '').strip().replace('\n', '').replace('\r', '').replace('\t', '')
    lowered = url.lower()
    if lowered.startswith(ALLOWED_URL_SCHEMES):
        return url
    if url.startswith('#') or url.startswith('/'):
        return url  # in-page anchors / relative paths
    # No scheme at all: treat as relative only if it does not look like
    # "scheme:" — this blocks obfuscated javascript: variants.
    if ':' not in url.split('?')[0].split('/')[0] and '@' not in url.split('/')[0].split('?')[0]:
        if url and not re.match(r'^\s*[\w\-]+:', url):
            return '/' + url if url.startswith('//') else url
    return ''


def _safe_style(value: str) -> str:
    """Keep only whitelisted CSS declarations; drop everything else."""
    kept = []
    for declaration in (value or '').split(';'):
        if ':' not in declaration:
            continue
        prop, _, val = declaration.partition(':')
        prop = prop.strip().lower()
        val = val.strip()
        if prop not in ALLOWED_STYLES or not val:
            continue
        # Block url(...) and expression() inside CSS values.
        if 'url(' in val.lower() or 'expression' in val.lower():
            continue
        kept.append(f'{prop}: {val}')
    return '; '.join(kept)


class _Sanitizer(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.out: list[str] = []
        self._drop_depth = 0

    # -- tag handling -------------------------------------------------------
    def handle_starttag(self, tag, attrs):
        tag = tag.lower()
        if self._drop_depth:
            if tag in DROP_WITH_CONTENT:
                self._drop_depth += 1
            return
        if tag in DROP_WITH_CONTENT:
            self._drop_depth = 1
            return
        if tag in ('html', 'body', 'head', '!doctype'):
            return
        if tag not in ALLOWED_TAGS:
            return  # unwrap: keep children/text, drop the tag
        allowed = ALLOWED_ATTRS.get(tag, set())
        rendered = []
        for name, value in attrs:
            name = (name or '').lower()
            if name not in allowed or _EVENT_ATTR_RE.match(name):
                continue
            value = value or ''
            if name == 'style':
                value = _safe_style(value)
                if not value:
                    continue
            elif name == 'href':
                value = _safe_url(value)
                if not value:
                    continue
            elif name == 'size' and tag == 'font':
                # execCommand fontSize uses size 1-7 only.
                if value not in {'1', '2', '3', '4', '5', '6', '7'}:
                    continue
            elif name in ('target', 'rel'):
                value = '_blank' if name == 'target' else 'noopener noreferrer'
            rendered.append(f'{name}="{html.escape(value, quote=True)}"')
        if tag == 'a' and not any(r.startswith('href=') for r in rendered):
            # An <a> without a safe href is pointless; keep it as text.
            return
        attr_str = (' ' + ' '.join(rendered)) if rendered else ''
        if tag == 'br':
            self.out.append('<br />')
        else:
            self.out.append(f'<{tag}{attr_str}>')

    def handle_startendtag(self, tag, attrs):
        tag = tag.lower()
        if tag == 'br':
            if not self._drop_depth:
                self.out.append('<br />')
            return
        self.handle_starttag(tag, attrs)
        if tag in ALLOWED_TAGS and tag != 'br' and not self._drop_depth:
            self.out.append(f'</{tag}>')

    def handle_endtag(self, tag):
        tag = tag.lower()
        if self._drop_depth:
            if tag in DROP_WITH_CONTENT:
                self._drop_depth -= 1
            return
        if tag in ALLOWED_TAGS and tag != 'br':
            self.out.append(f'</{tag}>')

    def handle_data(self, data):
        if self._drop_depth:
            return
        self.out.append(html.escape(data, quote=False))

    # Comments, CDATA, declarations, PIs are all dropped silently.
    def handle_comment(self, data):
        pass

    def handle_decl(self, decl):
        pass

    def handle_pi(self, data):
        pass

    def unknown_decl(self, data):
        pass


def sanitize_html(raw: str) -> str:
    """Sanitize an HTML fragment; returns safe HTML or '' for empty input."""
    if not raw or not (raw := raw.strip()):
        return ''
    parser = _Sanitizer()
    try:
        parser.feed(raw)
        parser.close()
    except Exception:
        return ''  # unparsable input is never trusted
    return ''.join(parser.out).strip()


_HTML_TAG_RE = re.compile(r'<[^>]+>')


def html_to_text(raw: str) -> str:
    """Derive a plain-text fallback from an HTML template body.

    Block elements become newlines, <br> becomes a newline, inline tags are
    unwrapped, entities are decoded. Safe for arbitrary input (the result is
    plain text; it is escaped again wherever it is embedded into HTML).
    """
    if not raw:
        return ''
    text = raw
    text = re.sub(r'(?is)<(script|style)\b[^>]*>.*?</\1>', '', text)
    text = re.sub(r'(?i)<br\s*/?>', '\n', text)
    text = re.sub(r'(?i)</(p|div|blockquote|li|h[1-6])>', '\n', text)
    text = re.sub(r'(?i)<li\b[^>]*>', '- ', text)
    text = re.sub(r'(?i)</?(ul|ol)\b[^>]*>', '\n', text)
    text = re.sub(r'(?i)<a\b[^>]*href=([\"\'])(.*?)\1[^>]*>(.*?)</a>',
                  lambda m: f'{m.group(3)} ({m.group(2)})', text)
    text = _HTML_TAG_RE.sub('', text)
    text = html.unescape(text)
    # Normalize whitespace: collapse spaces/tabs, keep at most one blank line.
    lines = [_WS_RE.sub(' ', line).strip() for line in text.split('\n')]
    out: list[str] = []
    blank = False
    for line in lines:
        if line:
            out.append(line)
            blank = False
        elif out and not blank:
            out.append('')
            blank = True
    return '\n'.join(out).strip()


def is_rich_html(raw: str) -> bool:
    """True if the template body already contains HTML markup."""
    return bool(raw) and bool(_HTML_TAG_RE.search(raw))
