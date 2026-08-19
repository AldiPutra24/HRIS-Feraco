from django.contrib.contenttypes.models import ContentType
from django.db.models import Model

from .models import AuditLog


def _client_ip(request):
    xff = request.META.get('HTTP_X_FORWARDED_FOR')
    if xff:
        return xff.split(',')[0].strip()
    return request.META.get('REMOTE_ADDR')


def log_event(request, action, *, user=None, obj=None, description=''):
    """Create an audit entry. obj may be a model instance for generic FK."""
    actor = user if user is not None else getattr(request, 'user', None)
    if actor is not None and not getattr(actor, 'is_authenticated', True):
        actor = None

    kwargs = {
        'action': action,
        'user': actor,
        'description': description,
        'ip_address': _client_ip(request) if request is not None else None,
    }
    if obj is not None and isinstance(obj, Model):
        kwargs['content_type'] = ContentType.objects.get_for_model(obj)
        kwargs['object_id'] = obj.pk
    return AuditLog.objects.create(**kwargs)
