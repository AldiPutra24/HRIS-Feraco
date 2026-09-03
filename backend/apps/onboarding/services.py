from apps.audit.services import log_event

from .models import Onboarding, OnboardingStatusHistory


def transition_onboarding(onboarding, to_status, request, note=''):
    """Validate + apply a forward-only status transition.

    Returns (onboarding, history) on success, or (None, None) when the
    transition is not allowed. COMPLETED sets completed_at; CANCELLED keeps
    it untouched.
    """
    allowed = Onboarding.TRANSITIONS.get(onboarding.status, set())
    if to_status not in allowed or to_status == onboarding.status:
        return None, None
    history = OnboardingStatusHistory.objects.create(
        onboarding=onboarding,
        from_status=onboarding.status,
        to_status=to_status,
        changed_by=request.user if request.user.is_authenticated else None,
        note=note,
    )
    onboarding.status = to_status
    if to_status == 'COMPLETED':
        from django.utils import timezone
        onboarding.completed_at = timezone.now()
    elif to_status == 'CANCELLED':
        onboarding.completed_at = None
    onboarding.save(update_fields=['status', 'completed_at', 'updated_at'])
    log_event(
        request,
        'update',
        obj=onboarding,
        description=(
            f'Onboarding "{onboarding.candidate.full_name}" status '
            f'{history.from_status} -> {history.to_status}'
        ),
    )
    return onboarding, history
