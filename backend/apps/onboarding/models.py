from django.conf import settings
from django.db import models


class Onboarding(models.Model):
    """Bridge between an OFFER_ACCEPTED Candidate and (later) Employee."""

    class Status(models.TextChoices):
        PENDING = 'PENDING', 'Pending'
        IN_PROGRESS = 'IN_PROGRESS', 'In Progress'
        DOCUMENT_REVIEW = 'DOCUMENT_REVIEW', 'Document Review'
        READY = 'READY', 'Ready'
        COMPLETED = 'COMPLETED', 'Completed'
        CANCELLED = 'CANCELLED', 'Cancelled'

    # Forward-only workflow. CANCELLED is allowed at any point before COMPLETED.
    TRANSITIONS = {
        'PENDING': {'IN_PROGRESS', 'CANCELLED'},
        'IN_PROGRESS': {'DOCUMENT_REVIEW', 'CANCELLED'},
        'DOCUMENT_REVIEW': {'READY', 'CANCELLED'},
        'READY': {'COMPLETED', 'CANCELLED'},
        'COMPLETED': set(),
        'CANCELLED': set(),
    }

    candidate = models.OneToOneField(
        'recruitment.Candidate',
        on_delete=models.CASCADE,
        related_name='onboarding',
    )
    status = models.CharField(
        max_length=32,
        choices=Status.choices,
        default=Status.PENDING,
    )
    target_join_date = models.DateField(null=True, blank=True)
    notes = models.TextField(blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='created_onboardings',
    )
    completed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'{self.candidate.full_name} ({self.status})'

    def is_editable(self):
        """Editable until terminal state (COMPLETED/CANCELLED)."""
        return self.status not in ('COMPLETED', 'CANCELLED')


class OnboardingStatusHistory(models.Model):
    """Audit trail of onboarding status transitions."""

    onboarding = models.ForeignKey(
        Onboarding,
        on_delete=models.CASCADE,
        related_name='status_history',
    )
    from_status = models.CharField(max_length=32)
    to_status = models.CharField(max_length=32)
    changed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='onboarding_status_changes',
    )
    changed_at = models.DateTimeField(auto_now_add=True)
    note = models.TextField(blank=True)

    class Meta:
        ordering = ['changed_at']

    def __str__(self):
        return f'{self.onboarding.candidate.full_name}: {self.from_status} -> {self.to_status}'
