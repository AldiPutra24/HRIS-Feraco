from django.conf import settings
from django.db import models
from django.utils import timezone


class Job(models.Model):
    """Recruitment job posting (public portal + internal management)."""

    STATUS_CHOICES = [
        ('DRAFT', 'Draft'),
        ('OPEN', 'Open'),
        ('CLOSED', 'Closed'),
    ]
    EMPLOYMENT_TYPES = [
        ('FULL_TIME', 'Full Time'),
        ('PART_TIME', 'Part Time'),
        ('CONTRACT', 'Contract'),
        ('INTERNSHIP', 'Internship'),
        ('FREELANCE', 'Freelance'),
    ]

    title = models.CharField(max_length=255)
    slug = models.SlugField(max_length=280, unique=True)
    department = models.ForeignKey(
        'personnel.Department',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='jobs',
    )
    position = models.ForeignKey(
        'personnel.Position',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='jobs',
    )
    description = models.TextField(blank=True)
    requirements = models.TextField(blank=True)
    employment_type = models.CharField(max_length=16, choices=EMPLOYMENT_TYPES, default='FULL_TIME')
    location = models.CharField(max_length=255, blank=True)
    open_date = models.DateField()
    close_date = models.DateField(null=True, blank=True)
    status = models.CharField(max_length=16, choices=STATUS_CHOICES, default='DRAFT')
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='created_jobs',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return self.title

    def is_open(self):
        """OPEN status and close_date not in the past."""
        if self.status != 'OPEN':
            return False
        if self.close_date and self.close_date < timezone.localdate():
            return False
        return True

    REQUIRED_FIELDS = [
        'title', 'department', 'position', 'description',
        'requirements', 'employment_type', 'location', 'open_date',
    ]

    def is_complete(self):
        """True when all fields required to publish are filled."""
        return all(getattr(self, f) for f in self.REQUIRED_FIELDS)


class Candidate(models.Model):
    """Public job applicant. CV binary lives in Supabase Storage."""

    SOURCE_CHOICES = [
        ('PORTAL', 'Public Portal'),
        ('REFERRAL', 'Referral'),
        ('WEBSITE', 'Company Website'),
        ('OTHER', 'Other'),
    ]
    STATUS_CHOICES = [
        ('APPLIED', 'Applied'),
        ('SCREENING', 'Screening'),
        ('INTERVIEW_HR', 'Interview HR'),
        ('INTERVIEW_USER', 'Interview User'),
        ('INTERVIEW_GM', 'Interview GM'),
        ('OFFERING', 'Offering'),
        ('OFFER_ACCEPTED', 'Offer Accepted'),
        ('REJECTED', 'Rejected'),
        ('WITHDRAWN', 'Withdrawn'),
    ]
    # Normal pipeline order. Terminal statuses (REJECTED/WITHDRAWN) excluded.
    PIPELINE = ['APPLIED', 'SCREENING', 'INTERVIEW_HR', 'INTERVIEW_USER', 'INTERVIEW_GM', 'OFFERING', 'OFFER_ACCEPTED']
    TERMINAL = {'REJECTED', 'WITHDRAWN'}
    # Allowed next status per current status. APPLIED may jump straight to
    # INTERVIEW_HR when screening is skipped; REJECTED/WITHDRAWN are terminal.
    TRANSITIONS = {
        'APPLIED': {'SCREENING', 'INTERVIEW_HR', 'REJECTED', 'WITHDRAWN'},
        'SCREENING': {'INTERVIEW_HR', 'REJECTED', 'WITHDRAWN'},
        'INTERVIEW_HR': {'INTERVIEW_USER', 'REJECTED', 'WITHDRAWN'},
        'INTERVIEW_USER': {'INTERVIEW_GM', 'REJECTED', 'WITHDRAWN'},
        'INTERVIEW_GM': {'OFFERING', 'REJECTED', 'WITHDRAWN'},
        'OFFERING': {'OFFER_ACCEPTED', 'REJECTED', 'WITHDRAWN'},
        'OFFER_ACCEPTED': {'REJECTED', 'WITHDRAWN'},
    }

    job = models.ForeignKey(Job, on_delete=models.CASCADE, related_name='applications')
    full_name = models.CharField(max_length=255)
    email = models.EmailField()
    phone = models.CharField(max_length=32, blank=True)
    cv_name = models.CharField(max_length=255, blank=True)
    cv_path = models.CharField(max_length=512, blank=True)
    cv_content_type = models.CharField(max_length=128, blank=True)
    source = models.CharField(max_length=32, choices=SOURCE_CHOICES, default='PORTAL')
    status = models.CharField(max_length=32, choices=STATUS_CHOICES, default='APPLIED')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'{self.full_name} -> {self.job.title}'


class CandidateStatusHistory(models.Model):
    """Audit trail of candidate status transitions."""

    candidate = models.ForeignKey(
        Candidate, on_delete=models.CASCADE, related_name='status_history'
    )
    from_status = models.CharField(max_length=32)
    to_status = models.CharField(max_length=32)
    changed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='candidate_status_changes',
    )
    changed_at = models.DateTimeField(auto_now_add=True)
    note = models.TextField(blank=True)

    class Meta:
        ordering = ['changed_at']

    def __str__(self):
        return f'{self.candidate.full_name}: {self.from_status} -> {self.to_status}'
