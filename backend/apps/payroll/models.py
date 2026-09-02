from decimal import Decimal

from django.conf import settings
from django.db import models
from django.core.exceptions import ValidationError


class PayrollComponent(models.Model):
    """Payroll payment type / component (earning or deduction).

    Categories map to the company's pay structure:
      - EARNING_FIXED   : Gaji Pokok, Tunjangan Tetap (Transport/Makan/Jabatan)
      - EARNING_VARIABLE: Tunjangan Tidak Tetap (Lembur/Insentif/Bonus), Reimbursement
      - DEDUCTION       : BPJS Kesehatan, BPJS Ketenagakerjaan, PPh21, Pinjaman/Kasbon,
                          Denda Keterlambatan
    """

    class Category(models.TextChoices):
        EARNING_FIXED = 'EARNING_FIXED', 'Earning Fixed'
        EARNING_VARIABLE = 'EARNING_VARIABLE', 'Earning Variable'
        DEDUCTION = 'DEDUCTION', 'Deduction'

    class CalculationType(models.TextChoices):
        FIXED_AMOUNT = 'FIXED_AMOUNT', 'Fixed Amount'
        VARIABLE = 'VARIABLE', 'Variable'
        PERCENTAGE = 'PERCENTAGE', 'Percentage'

    name = models.CharField(max_length=128)
    code = models.CharField(max_length=32, unique=True)
    category = models.CharField(max_length=32, choices=Category.choices, default=Category.EARNING_FIXED)
    calculation_type = models.CharField(
        max_length=32,
        choices=CalculationType.choices,
        default=CalculationType.FIXED_AMOUNT,
    )
    # Default amount used when creating salary structures (nullable for VARIABLE).
    default_amount = models.DecimalField(
        max_digits=14,
        decimal_places=2,
        null=True,
        blank=True,
    )
    is_active = models.BooleanField(default=True)
    description = models.TextField(blank=True)
    sort_order = models.PositiveIntegerField(default=0)
    is_reimbursement = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['sort_order', 'name']
        verbose_name = 'Payroll Component'
        verbose_name_plural = 'Payroll Components'

    def __str__(self):
        return f'{self.name} ({self.code})'


class SalaryStructure(models.Model):
    """Per-employee salary breakdown effective over a date range.

    History is preserved: every change inserts a new row; the current one is
    the single structure active at a given date.
    """

    employee = models.ForeignKey(
        'personnel.Employee',
        on_delete=models.CASCADE,
        related_name='salary_structures',
    )
    effective_from = models.DateField()
    effective_to = models.DateField(null=True, blank=True)
    basic_salary = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    is_active = models.BooleanField(default=True)
    # Fixed earning components (default amount copied at creation time).
    components = models.JSONField(default=list, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-effective_from']
        verbose_name = 'Salary Structure'
        verbose_name_plural = 'Salary Structures'

    def __str__(self):
        return f'{self.employee} - {self.effective_from}'

    def clean(self):
        if self.effective_to and self.effective_to < self.effective_from:
            raise ValidationError('effective_to tidak boleh sebelum effective_from.')

    def save(self, *args, **kwargs):
        self.full_clean()
        super().save(*args, **kwargs)


class PayrollPeriod(models.Model):
    """A payroll processing period / batch.

    Status transitions (one-way, no rollback):
      DRAFT → CALCULATED → REVIEW → APPROVED → PAID → LOCKED
    """

    class Status(models.TextChoices):
        DRAFT = 'DRAFT', 'Draft'
        CALCULATED = 'CALCULATED', 'Calculated'
        REVIEW = 'REVIEW', 'Review'
        APPROVED = 'APPROVED', 'Approved'
        PAID = 'PAID', 'Paid'
        LOCKED = 'LOCKED', 'Locked'

    TRANSITIONS = {
        Status.DRAFT: [Status.CALCULATED],
        Status.CALCULATED: [Status.REVIEW],
        Status.REVIEW: [Status.APPROVED],
        Status.APPROVED: [Status.PAID],
        Status.PAID: [Status.LOCKED],
    }

    period_month = models.PositiveIntegerField()  # 1-12
    period_year = models.PositiveIntegerField()
    period_start = models.DateField()
    period_end = models.DateField()
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.DRAFT)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='created_payroll_periods',
    )
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-period_year', '-period_month']
        unique_together = ['period_month', 'period_year']
        verbose_name = 'Payroll Period'
        verbose_name_plural = 'Payroll Periods'

    def __str__(self):
        return f'{self.period_month}/{self.period_year} ({self.get_status_display()})'

    def clean(self):
        if self.period_month < 1 or self.period_month > 12:
            raise ValidationError({'period_month': 'Bulan harus 1-12.'})
        if self.period_start and self.period_end and self.period_start > self.period_end:
            raise ValidationError('period_start tidak boleh setelah period_end.')
        # Validate status transition if this is an existing instance.
        if self.pk:
            old = PayrollPeriod.objects.get(pk=self.pk)
            if old.status != self.status:
                allowed = self.TRANSITIONS.get(old.status, [])
                if self.status not in allowed:
                    raise ValidationError(
                        f'Tidak dapat mengubah status dari {old.get_status_display()} '
                        f'ke {self.get_status_display()}.'
                    )

    def save(self, *args, **kwargs):
        self.full_clean()
        super().save(*args, **kwargs)

    def can_transition_to(self, target_status):
        return target_status in self.TRANSITIONS.get(self.status, [])


class Payroll(models.Model):
    """Per-employee payroll calculation result for a period."""

    period = models.ForeignKey(
        PayrollPeriod,
        on_delete=models.CASCADE,
        related_name='payrolls',
    )
    employee = models.ForeignKey(
        'personnel.Employee',
        on_delete=models.CASCADE,
        related_name='payrolls',
    )
    basic_salary = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    total_fixed_earning = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    total_variable_earning = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    total_deduction = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    reimbursement_total = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    gross_salary = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    net_salary = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['employee__full_name']
        unique_together = ['period', 'employee']
        verbose_name = 'Payroll'
        verbose_name_plural = 'Payrolls'

    def __str__(self):
        return f'{self.employee} - {self.period}'


class PayrollItem(models.Model):
    """Line item snapshot of a payroll component for a payroll record.

    Snapshot fields (component_name, component_code, category) are frozen at
    calculation time so historical data is never affected by component changes.
    """

    class Source(models.TextChoices):
        SYSTEM = 'SYSTEM', 'System'
        MANUAL = 'MANUAL', 'Manual'

    payroll = models.ForeignKey(
        Payroll,
        on_delete=models.CASCADE,
        related_name='items',
    )
    payroll_component = models.ForeignKey(
        PayrollComponent,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='payroll_items',
    )
    # Snapshot fields (frozen at calculation time).
    component_name = models.CharField(max_length=128)
    component_code = models.CharField(max_length=32)
    category = models.CharField(max_length=32, choices=PayrollComponent.Category.choices)
    amount = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    source = models.CharField(max_length=16, choices=Source.choices, default=Source.SYSTEM)
    description = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['payroll', 'id']
        verbose_name = 'Payroll Item'
        verbose_name_plural = 'Payroll Items'

    def __str__(self):
        return f'{self.component_code}: {self.amount}'
