from django.conf import settings


def _bucket():
    """Storage bucket for recruitment CV files."""
    return settings.RECRUITMENT_STORAGE_BUCKET