from django.conf import settings
from django.db import models


class LeaveType(models.Model):
    """Configurable leave category (annual, sick, maternity, marriage, ...).

    No hardcoded company policy — HR tunes `default_quota` and
    `requires_attachment` per type.
    """

    KIND_CHOICES = [
        ('LEAVE', 'Cuti'),
        ('PERMISSION', 'Izin'),
    ]

    kind = models.CharField(max_length=16, choices=KIND_CHOICES, default='LEAVE')
    name = models.CharField(max_length=128, unique=True)
    code = models.CharField(max_length=32, unique=True)
    is_active = models.BooleanField(default=True)
    default_quota = models.PositiveIntegerField(default=0)
    requires_attachment = models.BooleanField(default=False)
    description = models.TextField(blank=True)

    class Meta:
        ordering = ['name']

    def __str__(self):
        return self.name


class LeaveBalance(models.Model):
    """Per-employee, per-type, per-year leave quota."""

    employee = models.ForeignKey(
        'personnel.Employee',
        on_delete=models.CASCADE,
        related_name='leave_balances',
    )
    leave_type = models.ForeignKey(LeaveType, on_delete=models.CASCADE, related_name='balances')
    year = models.PositiveIntegerField()
    allocated_days = models.PositiveIntegerField(default=0)
    used_days = models.PositiveIntegerField(default=0)
    remaining_days = models.IntegerField(default=0)

    class Meta:
        ordering = ['-year', 'leave_type__name']
        unique_together = ('employee', 'leave_type', 'year')

    def __str__(self):
        return f'{self.employee} - {self.leave_type} ({self.year})'


class LeaveRequest(models.Model):
    STATUS_CHOICES = [
        ('DRAFT', 'Draft'),
        ('PENDING', 'Pending'),
        ('APPROVED', 'Approved'),
        ('REJECTED', 'Rejected'),
        ('CANCELLED', 'Cancelled'),
    ]

    employee = models.ForeignKey(
        'personnel.Employee',
        on_delete=models.CASCADE,
        related_name='leave_requests',
    )
    leave_type = models.ForeignKey(LeaveType, on_delete=models.PROTECT, related_name='requests')
    start_date = models.DateField()
    end_date = models.DateField()
    total_days = models.PositiveIntegerField(default=0)
    reason = models.TextField(blank=True)
    # Attachment binary lives in Supabase Storage (like EmployeeDocument).
    attachment_name = models.CharField(max_length=255, blank=True)
    attachment_path = models.CharField(max_length=512, blank=True)
    attachment_content_type = models.CharField(max_length=128, blank=True)
    status = models.CharField(max_length=16, choices=STATUS_CHOICES, default='PENDING')
    submitted_at = models.DateTimeField(auto_now_add=True)
    approved_at = models.DateTimeField(null=True, blank=True)
    rejected_at = models.DateTimeField(null=True, blank=True)
    approver = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='approved_leave_requests',
    )
    rejection_reason = models.TextField(blank=True)
    # Guards against double deduction when an approval is re-processed.
    balance_deducted = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'{self.employee} - {self.leave_type} ({self.start_date}..{self.end_date})'


class LeaveNotification(models.Model):
    """In-app notification (no external integration yet)."""

    recipient = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='leave_notifications',
    )
    leave_request = models.ForeignKey(LeaveRequest, on_delete=models.CASCADE, related_name='notifications')
    message = models.TextField()
    is_read = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'{self.recipient}: {self.message[:40]}'
