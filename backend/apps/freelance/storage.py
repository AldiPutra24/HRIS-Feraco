from django.conf import settings

from apps.personnel.storage import (
    delete_object,
    is_configured,
    signed_url,
    upload_bytes,
)

# Reuse the existing recruitment-cvs bucket (no new bucket).
def _bucket():
    return settings.RECRUITMENT_STORAGE_BUCKET


__all__ = ['_bucket', 'delete_object', 'is_configured', 'signed_url', 'upload_bytes']
