"""KMS storage helpers — reuse of apps.personnel.storage against a dedicated
private bucket (kms-documents / kms-documents-dev per APP_ENV)."""
from django.conf import settings

from apps.personnel.storage import delete_object, is_configured, signed_url, upload_bytes

__all__ = ['bucket', 'upload_attachment', 'attachment_url', 'delete_attachment', 'storage_ready']


def bucket() -> str:
    return (
        'kms-documents' if settings.APP_ENV == 'production' else 'kms-documents-dev'
    )


def upload_attachment(path: str, data: bytes, content_type: str) -> str:
    return upload_bytes(bucket(), path, data, content_type)


def attachment_url(path: str, expires_in: int = 3600) -> str:
    return signed_url(bucket(), path, expires_in)


def delete_attachment(path: str) -> bool:
    if not is_configured():
        return False
    return delete_object(bucket(), path)


def storage_ready() -> bool:
    return is_configured()
