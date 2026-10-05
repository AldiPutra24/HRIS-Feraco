from decimal import Decimal

from django.conf import settings
from django.db import models

# Leave day amounts support half days (0.5) -> one decimal place.
DAYS_FIELD = {'max_digits': 6, 'decimal_places': 1}


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
    # Business rules (None/0 = not enforced for that type).
    max_days_per_request = models.PositiveIntegerField(null=True, blank=True)
    min_tenure_months = models.PositiveIntegerField(null=True, blank=True)
    # Attachment becomes mandatory only above this many days (e.g. sick leave:
    # 1 day free, >1 day needs a doctor's note).
    max_days_without_attachment = models.PositiveIntegerField(default=0)
    # Unused days carried to next year's balance, capped.
    carry_forward_max = models.PositiveIntegerField(default=0)
    # Deducts from another type's balance (e.g. Cuti Berobat uses Cuti Tahunan).
    deducts_from = models.ForeignKey(
        'self',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='+',
    )
    is_paid = models.BooleanField(default=True)

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
    # Base quota from the quota engine (+ carry-forward). Never edited by
    # HR adjustments — those live in LeaveQuotaAdjustment rows and are
    # mirrored (summed) into adjustment_days.
    allocated_days = models.DecimalField(default=Decimal('0'), **DAYS_FIELD)
    adjustment_days = models.DecimalField(default=Decimal('0'), **DAYS_FIELD)
    used_days = models.DecimalField(default=Decimal('0'), **DAYS_FIELD)
    remaining_days = models.DecimalField(default=Decimal('0'), **DAYS_FIELD)

    class Meta:
        ordering = ['-year', 'leave_type__name']
        unique_together = ('employee', 'leave_type', 'year')

    def __str__(self):
        return f'{self.employee} - {self.leave_type} ({self.year})'

    @property
    def is_limited(self):
        """Quota enforced? allocated 0 + no adjustment = unlimited type."""
        return self.allocated_days > 0 or self.adjustment_days != 0

    def recompute(self):
        """Balance = base quota + HR adjustments - usage."""
        self.remaining_days = self.allocated_days + self.adjustment_days - self.used_days
        return self.remaining_days


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
    total_days = models.DecimalField(default=Decimal('0'), **DAYS_FIELD)
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

    def selected_dates(self):
        """Actual leave dates: explicit picks (non-consecutive support) or,
        for legacy requests without rows, the inclusive start..end range."""
        from datetime import timedelta

        return [d for d, _ in self.selected_days()]

    def selected_days(self):
        """[(date, portion)] — portion FULL/HALF; legacy rows are all FULL."""
        from datetime import timedelta

        rows = sorted((d.date, d.portion) for d in self.dates.all())
        if rows:
            return rows
        if not self.start_date or not self.end_date or self.end_date < self.start_date:
            return []
        span = (self.end_date - self.start_date).days
        return [(self.start_date + timedelta(days=i), 'FULL') for i in range(span + 1)]


class LeaveRequestDate(models.Model):
    """One explicitly selected leave day (e.g. 01, 02, 05 Sep).

    start_date/end_date on LeaveRequest stay filled with min/max for
    backward compatibility (reports, payroll overlap, legacy UI).
    """

    FULL = 'FULL'
    HALF = 'HALF'
    PORTION_CHOICES = [(FULL, 'Full Day'), (HALF, 'Half Day')]

    leave_request = models.ForeignKey(LeaveRequest, on_delete=models.CASCADE, related_name='dates')
    date = models.DateField()
    # Full Day = 1, Half Day = 0.5 (Cuti Tahunan).
    portion = models.CharField(max_length=4, choices=PORTION_CHOICES, default=FULL)

    class Meta:
        ordering = ['date']
        unique_together = ('leave_request', 'date')

    def __str__(self):
        return f'{self.leave_request_id}: {self.date}'


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


class LeaveQuotaAdjustment(models.Model):
    """Manual HR quota adjustment (audit trail) — e.g. +2 bonus lembur,
    -1 koreksi, +0.5 penyesuaian khusus.

    Immutable: corrections are made with another adjustment. The base quota
    (LeaveBalance.allocated_days) is never edited; the sum of adjustments is
    mirrored in LeaveBalance.adjustment_days.
    Balance = quota + adjustment - usage.
    """

    employee = models.ForeignKey(
        'personnel.Employee', on_delete=models.CASCADE, related_name='leave_quota_adjustments',
    )
    leave_type = models.ForeignKey(LeaveType, on_delete=models.PROTECT, related_name='quota_adjustments')
    year = models.PositiveIntegerField()
    amount = models.DecimalField(**DAYS_FIELD)
    reason = models.TextField()
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='leave_quota_adjustments',
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'{self.employee} {self.leave_type} {self.year}: {self.amount:+}'
