from django.conf import settings
from django.utils import timezone

from apps.audit.services import log_event

from .models import Candidate, CandidateStatusHistory


def _bucket():
    """Storage bucket for recruitment CV files."""
    return settings.RECRUITMENT_STORAGE_BUCKET


def transition_candidate(candidate, to_status, request, note='', inactive_reason=''):
    """Validate + apply a status transition. Returns (candidate, history) or
    (None, None) when the target is not in ``candidate.next_statuses()``.

    INACTIVE stores the structured reason (validated by the caller);
    reactivation clears it.
    """
    if to_status not in candidate.next_statuses() or to_status == candidate.status:
        return None, None
    history = CandidateStatusHistory.objects.create(
        candidate=candidate,
        from_status=candidate.status,
        to_status=to_status,
        changed_by=request.user if request.user.is_authenticated else None,
        note=note,
    )
    candidate.status = to_status
    if to_status == 'INACTIVE':
        candidate.inactive_reason = inactive_reason
        candidate.inactive_note = note
    else:
        candidate.inactive_reason = ''
        candidate.inactive_note = ''
    candidate.save(update_fields=['status', 'inactive_reason', 'inactive_note', 'updated_at'])
    log_event(
        request,
        'update',
        obj=candidate,
        description=f'Candidate "{candidate.full_name}" status {history.from_status} -> {history.to_status}',
    )
    return candidate, history


def record_screening(candidate, result, notes, request):
    """Store the screening result (notes required by the caller). A NEW
    application moves to SCREENED with a history entry; later stages keep
    their status (screening can be corrected afterwards)."""
    user = request.user if request.user.is_authenticated else None
    candidate.screening_result = result
    candidate.screening_notes = notes
    candidate.screened_at = timezone.now()
    candidate.screened_by = user
    fields = ['screening_result', 'screening_notes', 'screened_at', 'screened_by', 'updated_at']
    if candidate.status == 'NEW':
        CandidateStatusHistory.objects.create(
            candidate=candidate, from_status='NEW', to_status='SCREENED', changed_by=user,
            note=f'Screening: {candidate.get_screening_result_display()}',
        )
        candidate.status = 'SCREENED'
        fields.append('status')
    candidate.save(update_fields=fields)
    log_event(
        request, 'update', obj=candidate,
        description=f'Candidate "{candidate.full_name}" screening: {result}',
    )
    return candidate
