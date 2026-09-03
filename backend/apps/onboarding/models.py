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
        'READY': {'CANCELLED'},  # COMPLETED only via complete action
        'COMPLETED': set(),
        'CANCELLED': set(),
    }

    candidate = models.OneToOneField(
        'recruitment.Candidate',
        on_delete=models.CASCADE,
        related_name='onboarding',
    )
    employee = models.OneToOneField(
        'personnel.Employee',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='onboarding_entry',
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
    completed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='completed_onboardings',
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


class OnboardingData(models.Model):
    """Employment data for onboarding — biodata, financial, employment, probation."""

    EMPLOYMENT_TYPE_CHOICES = [
        ('PKWT', 'PKWT'),
        ('PKWTT', 'PKWTT'),
    ]

    onboarding = models.OneToOneField(
        Onboarding, on_delete=models.CASCADE, related_name='data'
    )

    # Biodata
    full_name = models.CharField(max_length=255)
    nik = models.CharField(max_length=32, unique=True, null=True, blank=True)
    birth_place = models.CharField(max_length=128, blank=True)
    birth_date = models.DateField(null=True, blank=True)
    address = models.TextField(blank=True)
    phone = models.CharField(max_length=32, blank=True)
    personal_email = models.EmailField(blank=True)
    emergency_contact_name = models.CharField(max_length=255, blank=True)
    emergency_contact_phone = models.CharField(max_length=32, blank=True)

    # Financial / Legal
    bank_account_number = models.CharField(max_length=64, blank=True)
    bank_account_name = models.CharField(max_length=255, blank=True)
    npwp = models.CharField(max_length=32, blank=True)
    bpjs_kesehatan = models.CharField(max_length=32, blank=True)
    bpjs_ketenagakerjaan = models.CharField(max_length=32, blank=True)

    # Employment
    department = models.ForeignKey(
        'personnel.Department',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='onboarding_data',
    )
    position = models.ForeignKey(
        'personnel.Position',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='onboarding_data',
    )
    reporting_to = models.ForeignKey(
        'personnel.Personnel',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='onboarding_reports',
    )
    join_date = models.DateField(null=True, blank=True)
    employment_type = models.CharField(
        max_length=16, choices=EMPLOYMENT_TYPE_CHOICES, default='PKWTT'
    )

    # Probation (PKWTT only)
    probation_enabled = models.BooleanField(default=False)
    probation_start_date = models.DateField(null=True, blank=True)
    probation_end_date = models.DateField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name_plural = 'onboarding data'

    def __str__(self):
        return f'Data for {self.onboarding.candidate.full_name}'


class OnboardingChecklistItem(models.Model):
    """Configurable checklist item for onboarding."""

    onboarding = models.ForeignKey(
        Onboarding, on_delete=models.CASCADE, related_name='checklist_items'
    )
    name = models.CharField(max_length=255)
    code = models.CharField(max_length=64)
    category = models.CharField(max_length=64, blank=True, default='')
    required = models.BooleanField(default=True)
    completed = models.BooleanField(default=False)
    notes = models.TextField(blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    completed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='completed_checklist_items',
    )
    ordering = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ['ordering', 'id']
        unique_together = [('onboarding', 'code')]

    def __str__(self):
        return f'{self.code} - {"✓" if self.completed else "○"}'


class OnboardingDocument(models.Model):
    """Document uploaded during onboarding — stored in Supabase Storage."""

    class DocType(models.TextChoices):
        KTP = 'KTP', 'KTP'
        KK = 'KK', 'Kartu Keluarga'
        NPWP = 'NPWP', 'NPWP'
        BPJS_KESEHATAN = 'BPJS_KESEHATAN', 'BPJS Kesehatan'
        BPJS_KETENAGAKERJAAN = 'BPJS_KETENAGAKERJAAN', 'BPJS Ketenagakerjaan'
        BUKU_REKENING = 'BUKU_REKENING', 'Buku Rekening'
        IJAZAH = 'IJAZAH', 'Ijazah'
        KONTRAK_KERJA = 'KONTRAK_KERJA', 'Kontrak Kerja'
        LAINNYA = 'LAINNYA', 'Lainnya'

    class Status(models.TextChoices):
        PENDING = 'PENDING', 'Pending'
        APPROVED = 'APPROVED', 'Approved'
        REJECTED = 'REJECTED', 'Rejected'

    onboarding = models.ForeignKey(
        Onboarding, on_delete=models.CASCADE, related_name='documents'
    )
    document_type = models.CharField(
        max_length=32, choices=DocType.choices, default=DocType.LAINNYA
    )
    original_filename = models.CharField(max_length=255)
    storage_path = models.CharField(max_length=512)
    file_size = models.PositiveBigIntegerField(default=0)
    mime_type = models.CharField(max_length=128, blank=True)
    status = models.CharField(
        max_length=16, choices=Status.choices, default=Status.PENDING
    )
    notes = models.TextField(blank=True)
    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='uploaded_onboarding_docs',
    )
    reviewed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='reviewed_onboarding_docs',
    )
    reviewed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'{self.document_type}: {self.original_filename}'
