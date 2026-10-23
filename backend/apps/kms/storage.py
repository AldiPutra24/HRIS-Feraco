"""KMS storage helpers — reuse of apps.personnel.storage against a dedicated
private bucket (kms-documents / kms-documents-dev per APP_ENV)."""
from django.conf import settings

from apps.personnel.storage import delete_object, is_configured, upload_bytes

__all__ = ['bucket', 'upload_attachment', 'delete_attachment', 'storage_ready']


def bucket() -> str:
    return (
        'kms-documents' if settings.APP_ENV == 'production' else 'kms-documents-dev'
    )


def upload_attachment(path: str, data: bytes, content_type: str) -> str:
    return upload_bytes(bucket(), path, data, content_type)


def delete_attachment(path: str) -> bool:
    if not is_configured():
        return False
    return delete_object(bucket(), path)


def storage_ready() -> bool:
    return is_configured()
