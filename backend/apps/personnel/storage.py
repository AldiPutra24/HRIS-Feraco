"""Supabase Storage client for private employee documents.

Uses the service-role key server-side only. Binary files live in a private
bucket; the DB stores only metadata (path, content_type, size, version).
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


def upload_bytes(bucket, path, data: bytes, content_type='application/octet-stream'):
    """Upload raw bytes to a private bucket path. Returns storage path."""
    url = f'{_storage_base()}/{bucket}/{_quoted_path(path)}'
    res = requests.post(
        url,
        headers={**_headers(), 'Content-Type': content_type, 'x-upsert': 'false'},
        data=data,
        timeout=120,
    )
    if res.status_code not in (200, 201):
        raise RuntimeError(f'Storage upload failed ({res.status_code}): {res.text[:200]}')
    return path


def delete_object(bucket, path):
    url = f'{_storage_base()}/{bucket}/{_quoted_path(path)}'
    res = requests.delete(url, headers=_headers(), timeout=30)
    return res.status_code in (200, 204)


def signed_url(bucket, path, expires_in=3600, download=None):
    """Create a short-lived signed URL for private object access.

    `download` (optional filename) asks Supabase to send Content-Disposition
    attachment so the browser downloads the ORIGINAL file under that name
    instead of rendering it.
    """
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


def is_configured():
    return bool(settings.SUPABASE_URL and settings.SUPABASE_SECRET_KEY)
