from django.conf import settings
from django.db import models


class ReimbursementCategory(models.Model):
    """Configurable reimbursement category (transport, medical, meal, ...)."""

    name = models.CharField(max_length=128, unique=True)
    code = models.CharField(max_length=32, unique=True)
    is_active = models.BooleanField(default=True)
    requires_attachment = models.BooleanField(default=False)
    description = models.TextField(blank=True)

    class Meta:
        ordering = ['name']

    def __str__(self):
        return self.name


class Reimbursement(models.Model):
    STATUS_CHOICES = [
        ('DRAFT', 'Draft'),
        ('PENDING', 'Pending'),
        ('APPROVED', 'Approved'),
        ('REJECTED', 'Rejected'),
        ('PAID', 'Paid'),
        ('CANCELLED', 'Cancelled'),
    ]

    PROJECT_CATEGORY_CHOICES = [
        ('OPERASIONAL_FERACO_JAKARTA', 'Operasional Feraco Jakarta'),
        ('OPERASIONAL_FERACO_JOGJA', 'Operasional Feraco Jogja'),
        ('GPFE', 'GPFE'),
        ('INACRAFT', 'Inacraft'),
        ('PENAS', 'Penas'),
        ('LEARNING_DEVELOPMENT', 'Learning & Development'),
        ('OTHER', 'Other'),
    ]

    employee = models.ForeignKey(
        'personnel.Employee',
        on_delete=models.CASCADE,
        related_name='reimbursements',
    )
    category = models.ForeignKey(ReimbursementCategory, on_delete=models.PROTECT, related_name='reimbursements')
    transaction_date = models.DateField()
    amount = models.DecimalField(max_digits=14, decimal_places=2)
    approved_amount = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    project_category = models.CharField(max_length=32, choices=PROJECT_CATEGORY_CHOICES, blank=True, default='')
    project_category_other = models.CharField(max_length=255, blank=True, default='')
    description = models.TextField(blank=True)
    # Attachment binary lives in Supabase Storage (like LeaveRequest).
    attachment_name = models.CharField(max_length=255, blank=True)
    attachment_path = models.CharField(max_length=512, blank=True)
    attachment_content_type = models.CharField(max_length=128, blank=True)
    status = models.CharField(max_length=16, choices=STATUS_CHOICES, default='DRAFT')
    submitted_at = models.DateTimeField(null=True, blank=True)
    approved_at = models.DateTimeField(null=True, blank=True)
    rejected_at = models.DateTimeField(null=True, blank=True)
    paid_at = models.DateTimeField(null=True, blank=True)
    reviewer = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='reviewed_reimbursements',
    )
    rejection_reason = models.TextField(blank=True)
    payment_reference = models.CharField(max_length=128, blank=True)
    # Payment proof (bukti transfer) lives in Supabase Storage, like attachment.
    payment_proof_name = models.CharField(max_length=255, blank=True)
    payment_proof_path = models.CharField(max_length=512, blank=True)
    payment_proof_content_type = models.CharField(max_length=128, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'{self.employee} - {self.category} ({self.amount})'


class ReimbursementNotification(models.Model):
    """In-app notification (no external integration yet)."""

    recipient = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='reimbursement_notifications',
    )
    reimbursement = models.ForeignKey(Reimbursement, on_delete=models.CASCADE, related_name='notifications')
    message = models.TextField()
    is_read = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'{self.recipient}: {self.message[:40]}'
