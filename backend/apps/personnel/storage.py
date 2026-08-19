"""Supabase Storage client for private employee documents.

Uses the service-role key server-side only. Binary files live in a private
bucket; the DB stores only metadata (path, content_type, size, version).
"""
import os

import requests
from django.conf import settings

_UPLOAD_CHUNK = 1024 * 1024  # 1 MiB


def _headers():
    return {
        'Authorization': f'Bearer {settings.SUPABASE_SECRET_KEY}',
        'apikey': settings.SUPABASE_SECRET_KEY,
    }


def _storage_base():
    return f"{settings.SUPABASE_URL.rstrip('/')}/storage/v1/object"


def upload_bytes(bucket, path, data: bytes, content_type='application/octet-stream'):
    """Upload raw bytes to a private bucket path. Returns storage path."""
    url = f'{_storage_base()}/{bucket}/{path}'
    res = requests.post(
        url,
        headers={**_headers(), 'Content-Type': content_type, 'x-upsert': 'false'},
        data=data,
        timeout=60,
    )
    if res.status_code not in (200, 201):
        raise RuntimeError(f'Storage upload failed ({res.status_code}): {res.text[:200]}')
    return path


def delete_object(bucket, path):
    url = f'{_storage_base()}/{bucket}/{path}'
    res = requests.delete(url, headers=_headers(), timeout=30)
    return res.status_code in (200, 204)


def signed_url(bucket, path, expires_in=3600):
    """Create a short-lived signed URL for private object access."""
    url = f'{_storage_base()}/sign/{bucket}/{path}'
    res = requests.post(url, headers=_headers(), json={'expiresIn': expires_in}, timeout=30)
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
