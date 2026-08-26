from django.contrib.contenttypes.models import ContentType
from django.db.models import Model

from .models import AuditLog


def _client_ip(request):
    xff = request.META.get('HTTP_X_FORWARDED_FOR')
    if xff:
        return xff.split(',')[0].strip()
    return request.META.get('REMOTE_ADDR')


SENSITIVE_FIELDS = {
    'password', 'secret', 'token', 'api_key', 'refresh', 'access',
    'session_key', 'csrf', 'bank_account_number', 'npwp', 'bpjs_kesehatan',
    'bpjs_ketenagakerjaan', 'nik',
}


def _user_agent(request):
    return (request.META.get('HTTP_USER_AGENT') or '')[:255]


def _sanitize(data):
    """Redact sensitive values recursively. Returns JSON-safe dict."""
    if not isinstance(data, dict):
        return data
    out = {}
    for key, value in data.items():
        if any(s in key.lower() for s in SENSITIVE_FIELDS):
            out[key] = '[REDACTED]'
        elif isinstance(value, dict):
            out[key] = _sanitize(value)
        else:
            out[key] = value
    return out


def diff_changes(old, new):
    """Return (before, after) dicts of fields that changed (sanitized)."""
    before, after = {}, {}
    for field in new:
        ov, nv = old.get(field), new[field]
        if ov == nv:
            continue
        before[field], after[field] = ov, nv
    return _sanitize(before), _sanitize(after)


def log_event(
    request,
    action,
    *,
    user=None,
    obj=None,
    description='',
    changes_before=None,
    changes_after=None,
    metadata=None,
):
    """Create an audit entry. obj may be a model instance for generic FK.

    `changes_before`/`changes_after` are JSON-safe dicts; they are sanitized
    before persistence so secrets never land in the audit log.
    """
    actor = user if user is not None else getattr(request, 'user', None)
    if actor is not None and not getattr(actor, 'is_authenticated', True):
        actor = None

    kwargs = {
        'action': action,
        'user': actor,
        'description': description,
        'ip_address': _client_ip(request) if request is not None else None,
        'user_agent': _user_agent(request) if request is not None else '',
        'changes_before': _sanitize(changes_before) or {},
        'changes_after': _sanitize(changes_after) or {},
        'metadata': _sanitize(metadata) or {},
    }
    if obj is not None and isinstance(obj, Model):
        kwargs['content_type'] = ContentType.objects.get_for_model(obj)
        kwargs['object_id'] = obj.pk
    return AuditLog.objects.create(**kwargs)


def log_model_update(request, instance, before_fields, after_fields, *, description='', action='update', metadata=None):
    """Convenience: log an update with only the changed fields recorded."""
    before, after = diff_changes(before_fields, after_fields)
    return log_event(
        request,
        action,
        obj=instance,
        description=description,
        changes_before=before,
        changes_after=after,
        metadata=metadata,
    )
