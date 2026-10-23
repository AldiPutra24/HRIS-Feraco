"""Private object storage for HRIS files (documents, photos, attachments).

Two backends, chosen by settings.STORAGE_BACKEND:
  - 'supabase': Supabase Storage REST API with the service-role key.
  - 'r2': Cloudflare R2 (S3 API). One R2 bucket; the logical bucket name
    used by the apps ('employee-documents', 'employee-photos', ...) becomes
    the key prefix, so stored paths stay identical after migration
    (`migrate_storage_to_r2` copies Supabase -> R2 with the same keys).

Credentials are server-side only. The DB stores only metadata (path,
content_type, size, version); files are served by the backend
(stream_file_response) or, for photos, via short-lived signed URLs.
"""
import os
import string
import unicodedata
from urllib.parse import quote

import requests
from django.conf import settings

_UPLOAD_CHUNK = 1024 * 1024  # 1 MiB

# Characters Supabase Storage accepts in an object key. Anything else (e.g.
# '[', ']', '%', '#', '~', non-ASCII like 'é' or the '–' dash Word puts in
# filenames) is rejected with 400 "Invalid key" -> was an unhandled 500.
_KEY_ALLOWED = frozenset(string.ascii_letters + string.digits + "_/!-.*'() &$@=;:+,?")


def object_key(path):
    """Storage-safe object key for a (user-supplied) path.

    Deterministic and idempotent: valid keys are returned unchanged, so paths
    already stored in the DB keep resolving to the same object. Accented
    letters are transliterated ('é' -> 'e'); other invalid chars become '_'.
    The original filename is kept in the DB for display — only the key changes.
    """
    out = []
    for ch in path:
        if ch in _KEY_ALLOWED:
            out.append(ch)
            continue
        ascii_ch = unicodedata.normalize('NFKD', ch).encode('ascii', 'ignore').decode()
        out.append(ascii_ch if ascii_ch and all(c in _KEY_ALLOWED for c in ascii_ch) else '_')
    return ''.join(out)


def _quoted_path(path):
    """Storage-safe key, percent-encoded for use in the storage URL.

    Characters like '&', '?' and spaces are valid in a key but must be encoded
    in the URL ('&'/'?' would truncate the path). Slash separators must
    survive, hence safe='/'.
    """
    return quote(object_key(path), safe='/')


def _headers():
    return {
        'Authorization': f'Bearer {settings.SUPABASE_SECRET_KEY}',
        'apikey': settings.SUPABASE_SECRET_KEY,
    }


def _storage_base():
    return f"{settings.SUPABASE_URL.rstrip('/')}/storage/v1/object"


def _backend():
    return (getattr(settings, 'STORAGE_BACKEND', 'supabase') or 'supabase').lower()


# ---------------------------------------------------------------------------
# Supabase Storage (REST)
# ---------------------------------------------------------------------------

def supabase_configured():
    return bool(settings.SUPABASE_URL and settings.SUPABASE_SECRET_KEY)


def _sb_upload(bucket, path, data, content_type):
    url = f'{_storage_base()}/{bucket}/{_quoted_path(path)}'
    res = requests.post(
        url,
        headers={**_headers(), 'Content-Type': content_type, 'x-upsert': 'false'},
        data=data,
        timeout=120,
    )
    if res.status_code not in (200, 201):
        raise RuntimeError(f'Storage upload failed ({res.status_code}): {res.text[:200]}')


def _sb_delete(bucket, path):
    url = f'{_storage_base()}/{bucket}/{_quoted_path(path)}'
    res = requests.delete(url, headers=_headers(), timeout=30)
    return res.status_code in (200, 204)


def _sb_signed_url(bucket, path, expires_in, download):
    url = f'{_storage_base()}/sign/{bucket}/{_quoted_path(path)}'
    payload = {'expiresIn': expires_in}
    if download:
        payload['download'] = download
    res = requests.post(url, headers=_headers(), json=payload, timeout=30)
    if res.status_code != 200:
        raise RuntimeError(f'Signed URL failed ({res.status_code})')
    signed = res.json().get('signedURL') or res.json().get('signedUrl')
    if not signed:
        raise RuntimeError('Signed URL missing in response')
    if signed.startswith('/'):
        signed = settings.SUPABASE_URL.rstrip('/') + '/storage/v1' + signed
    return signed


def supabase_open_object(bucket, path):
    """Stream a Supabase object server-side with the service key.

    Same `/object/<bucket>/<key>` route and key encoding as the upload, so
    it reaches exactly the stored object. Unlike signed URLs there is no
    signature check, which Supabase fails for keys with reserved characters
    such as ',' or '&' (the sign endpoint signs '%2C' literally while the
    visited link decodes it to ',' -> 400 InvalidSignature).
    Returns a streaming `requests.Response` (caller must close it); raises
    RuntimeError on failure. Also the source of `migrate_storage_to_r2`.
    """
    url = f'{_storage_base()}/{bucket}/{_quoted_path(path)}'
    res = requests.get(url, headers=_headers(), timeout=120, stream=True)
    if res.status_code != 200:
        detail = res.text[:200]
        res.close()
        raise RuntimeError(f'Storage download failed ({res.status_code}): {detail}')
    return res


def supabase_list_buckets():
    res = requests.get(f"{settings.SUPABASE_URL.rstrip('/')}/storage/v1/bucket", headers=_headers(), timeout=30)
    if res.status_code != 200:
        raise RuntimeError(f'Bucket list failed ({res.status_code}): {res.text[:200]}')
    return [b['name'] for b in res.json()]


def supabase_list_objects(bucket, prefix=''):
    """Yield (key, size) of every object under `prefix`, walking folders."""
    url = f'{_storage_base()}/list/{bucket}'
    offset = 0
    while True:
        res = requests.post(url, headers=_headers(), timeout=60, json={
            'prefix': prefix, 'limit': 1000, 'offset': offset,
            'sortBy': {'column': 'name', 'order': 'asc'},
        })
        if res.status_code != 200:
            raise RuntimeError(f'List failed {bucket}/{prefix} ({res.status_code}): {res.text[:200]}')
        items = res.json()
        for item in items:
            key = f"{prefix}/{item['name']}" if prefix else item['name']
            if item.get('id') is None:  # folder placeholder -> recurse
                yield from supabase_list_objects(bucket, key)
            else:
                yield key, int((item.get('metadata') or {}).get('size') or 0)
        if len(items) < 1000:
            return
        offset += 1000


# ---------------------------------------------------------------------------
# Cloudflare R2 (S3 API)
# ---------------------------------------------------------------------------

_r2_client_cache = {}


def r2_configured():
    return bool(settings.R2_ACCOUNT_ID and settings.R2_ACCESS_KEY_ID and settings.R2_SECRET_ACCESS_KEY
                and settings.R2_BUCKET)


def r2_client():
    cache_key = (settings.R2_ACCOUNT_ID, settings.R2_ACCESS_KEY_ID)
    if cache_key not in _r2_client_cache:
        import boto3
        from botocore.config import Config

        _r2_client_cache[cache_key] = boto3.client(
            's3',
            endpoint_url=f'https://{settings.R2_ACCOUNT_ID}.r2.cloudflarestorage.com',
            aws_access_key_id=settings.R2_ACCESS_KEY_ID,
            aws_secret_access_key=settings.R2_SECRET_ACCESS_KEY,
            region_name='auto',
            config=Config(signature_version='s3v4', retries={'max_attempts': 3, 'mode': 'standard'},
                          connect_timeout=10, read_timeout=120),
        )
    return _r2_client_cache[cache_key]


def r2_key(bucket, path):
    """R2 key for a logical bucket + stored path (same key Supabase used)."""
    return f'{bucket}/{object_key(path)}'


def _r2_error(exc):
    response = getattr(exc, 'response', None) or {}
    code = response.get('Error', {}).get('Code', '')
    status = response.get('ResponseMetadata', {}).get('HTTPStatusCode', '')
    return f'{status} {code or exc.__class__.__name__}'.strip()


def r2_head(bucket, path):
    """Object size in R2, or None when it does not exist."""
    from botocore.exceptions import BotoCoreError, ClientError

    try:
        head = r2_client().head_object(Bucket=settings.R2_BUCKET, Key=r2_key(bucket, path))
        return int(head.get('ContentLength', 0))
    except ClientError as exc:
        if exc.response.get('ResponseMetadata', {}).get('HTTPStatusCode') == 404:
            return None
        raise RuntimeError(f'Storage check failed ({_r2_error(exc)})') from exc
    except BotoCoreError as exc:
        raise RuntimeError(f'Storage check failed ({_r2_error(exc)})') from exc


def _r2_upload(bucket, path, data, content_type):
    from botocore.exceptions import BotoCoreError, ClientError

    # Same semantics as Supabase `x-upsert: false`: never overwrite silently.
    if r2_head(bucket, path) is not None:
        raise RuntimeError('Storage upload failed (409): The resource already exists')
    try:
        r2_client().put_object(Bucket=settings.R2_BUCKET, Key=r2_key(bucket, path), Body=data,
                               ContentType=content_type or 'application/octet-stream')
    except (BotoCoreError, ClientError) as exc:
        raise RuntimeError(f'Storage upload failed ({_r2_error(exc)})') from exc


def _r2_delete(bucket, path):
    from botocore.exceptions import BotoCoreError, ClientError

    try:
        r2_client().delete_object(Bucket=settings.R2_BUCKET, Key=r2_key(bucket, path))
        return True
    except (BotoCoreError, ClientError):
        return False


def _r2_signed_url(bucket, path, expires_in, download):
    from urllib.parse import quote as urlquote

    params = {'Bucket': settings.R2_BUCKET, 'Key': r2_key(bucket, path)}
    if download:
        params['ResponseContentDisposition'] = (
            f'attachment; filename="{download}"; ' + "filename*=UTF-8''" + urlquote(download)
        )
    return r2_client().generate_presigned_url('get_object', Params=params, ExpiresIn=expires_in)


class _R2Stream:
    """Minimal `requests.Response`-like wrapper (iter_content/close) so
    stream_file_response works unchanged for both backends."""

    def __init__(self, body):
        self._body = body

    def iter_content(self, chunk_size=64 * 1024):
        return self._body.iter_chunks(chunk_size=chunk_size)

    def close(self):
        self._body.close()


def _r2_open(bucket, path):
    from botocore.exceptions import BotoCoreError, ClientError

    try:
        obj = r2_client().get_object(Bucket=settings.R2_BUCKET, Key=r2_key(bucket, path))
    except (BotoCoreError, ClientError) as exc:
        raise RuntimeError(f'Storage download failed ({_r2_error(exc)})') from exc
    return _R2Stream(obj['Body'])


# ---------------------------------------------------------------------------
# Public API (used by every app) - dispatches to the configured backend
# ---------------------------------------------------------------------------

def upload_bytes(bucket, path, data: bytes, content_type='application/octet-stream'):
    """Upload raw bytes to a private bucket path. Returns storage path.
    Raises RuntimeError on failure (incl. an existing object: no overwrite)."""
    if _backend() == 'r2':
        _r2_upload(bucket, path, data, content_type)
    else:
        _sb_upload(bucket, path, data, content_type)
    return path


def delete_object(bucket, path):
    if _backend() == 'r2':
        return _r2_delete(bucket, path)
    return _sb_delete(bucket, path)


def signed_url(bucket, path, expires_in=3600, download=None):
    """Short-lived signed URL for private object access (profile photos).

    `download` (optional filename) sends Content-Disposition attachment so
    the browser downloads the ORIGINAL file under that name.
    """
    if _backend() == 'r2':
        return _r2_signed_url(bucket, path, expires_in, download)
    return _sb_signed_url(bucket, path, expires_in, download)


def open_object(bucket, path):
    """Stream an object server-side. Returns an object with
    `iter_content(chunk_size)` and `close()`; raises RuntimeError."""
    if _backend() == 'r2':
        return _r2_open(bucket, path)
    return supabase_open_object(bucket, path)


# Types safe to render INLINE on our own origin, detected from the file's
# real content (never from the client-supplied content type). Anything else
# (HTML, SVG, scripts, Office files, ...) is forced to download, so an uploaded
# file can never execute in the HRIS origin (stored XSS).
_INLINE_SIGNATURES = (
    ('application/pdf', lambda b: b[:5] == b'%PDF-'),
    ('image/png', lambda b: b[:8] == b'\x89PNG\r\n\x1a\n'),
    ('image/jpeg', lambda b: b[:3] == b'\xff\xd8\xff'),
    ('image/webp', lambda b: b[:4] == b'RIFF' and b[8:12] == b'WEBP'),
)


def inline_content_type(head: bytes):
    """Content type to render inline for these leading bytes, or None."""
    for content_type, matches in _INLINE_SIGNATURES:
        if matches(head):
            return content_type
    return None


def is_configured():
    return r2_configured() if _backend() == 'r2' else supabase_configured()


def stream_file_response(bucket, path, filename, attachment=False, cache_seconds=0):
    """Serve a private storage object through the backend (no signed URL).

    Signed URLs fail with 400 InvalidSignature for keys containing reserved
    characters such as ',' or '&'; streaming with the service key does not.
    PDF/PNG/JPEG/WEBP (detected from the real bytes, never the stored type)
    render inline; anything else downloads as octet-stream so an uploaded
    file can never execute in the HRIS origin. `attachment=True` always
    downloads. `cache_seconds` allows private browser caching (only for
    versioned URLs, e.g. profile photos). Raises RuntimeError when the
    object cannot be fetched.
    """
    from itertools import chain
    from urllib.parse import quote as urlquote

    from django.http import StreamingHttpResponse

    upstream = open_object(bucket, path)
    chunks = upstream.iter_content(chunk_size=64 * 1024)
    # Buffer enough leading bytes to detect the real type, even if the
    # upstream delivers tiny first chunks.
    head = b''
    for chunk in chunks:
        head += chunk
        if len(head) >= 16:
            break
    inline_type = inline_content_type(head)

    def body():
        try:
            yield from chain([head], chunks)
        finally:
            upstream.close()

    response = StreamingHttpResponse(body(), content_type=inline_type or 'application/octet-stream')
    safe_name = ''.join(ch for ch in (filename or '') if ch.isprintable() and ch not in '"\\') or 'dokumen'
    ascii_name = safe_name.encode('ascii', 'ignore').decode() or 'dokumen'
    response['Content-Disposition'] = (
        f'{"inline" if inline_type and not attachment else "attachment"}; filename="{ascii_name}"; '
        f"filename*=UTF-8''{urlquote(safe_name)}"
    )
    response['X-Content-Type-Options'] = 'nosniff'
    response['Cache-Control'] = f'private, max-age={cache_seconds}' if cache_seconds else 'private, no-store'
    return response


def employee_photo_url(employee, request=None):
    """Backend URL of an employee's profile photo (streamed by
    EmployeeViewSet.photo), versioned by the stored file name so a new photo
    gets a new URL. Absolute when a request is available."""
    if not employee or not employee.photo or not is_configured():
        return None
    from urllib.parse import quote as urlquote

    path = f'/api/employees/{employee.pk}/photo/?v={urlquote(employee.photo)}'
    if request is not None:
        return request.build_absolute_uri(path)
    base = getattr(settings, 'HRIS_PUBLIC_URL', '')
    return f'{base}{path}' if base else path


def stream_link_or_file(request, bucket, path, filename, **extra):
    """For download endpoints whose frontend expects JSON `{url, ...}` and
    opens it with window.open: without `?raw=1` return a link back to this
    same endpoint; with `?raw=1` stream the file (stream_file_response).

    Replaces Supabase signed URLs (InvalidSignature on names with ',' / '&').
    The endpoint's own permission checks run on both requests.
    """
    from rest_framework import status
    from rest_framework.response import Response

    if request.query_params.get('raw') == '1':
        try:
            return stream_file_response(bucket, path, filename)
        except Exception as exc:
            return Response(
                {'detail': f'Gagal mengambil file dari storage: {str(exc)[:150]}'},
                status=status.HTTP_502_BAD_GATEWAY,
            )
    return Response({'url': request.build_absolute_uri(f'{request.path}?raw=1'), **extra})
