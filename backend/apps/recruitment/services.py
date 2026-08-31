from django.conf import settings

from apps.audit.services import log_event

from .models import Candidate, CandidateStatusHistory


def _bucket():
    """Storage bucket for recruitment CV files."""
    return settings.RECRUITMENT_STORAGE_BUCKET


def transition_candidate(candidate, to_status, request, note=''):
    """Validate + apply a status transition. Returns (candidate, history) or (None, None)."""
    allowed = Candidate.TRANSITIONS.get(candidate.status, set())
    if to_status not in allowed or to_status == candidate.status:
        return None, None
    history = CandidateStatusHistory.objects.create(
        candidate=candidate,
        from_status=candidate.status,
        to_status=to_status,
        changed_by=request.user if request.user.is_authenticated else None,
        note=note,
    )
    candidate.status = to_status
    candidate.save(update_fields=['status', 'updated_at'])
    log_event(
        request,
        'update',
        obj=candidate,
        description=f'Candidate "{candidate.full_name}" status {history.from_status} -> {history.to_status}',
    )
    return candidate, history