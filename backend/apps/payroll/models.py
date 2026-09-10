from decimal import Decimal

from django.conf import settings
from django.db import models
from django.core.exceptions import ValidationError


class TaxConfig(models.Model):
    """Per-tax-year PPh 21 configuration (PRD 4.4 — data, never hardcoded).

    Rates are loaded from the official PMK 168/2023 tables (via the company's
    tax consultant). Illustrative values must never be seeded as is_active.
    """

    class TerCategory(models.TextChoices):
        A = 'A', 'TER A'
        B = 'B', 'TER B'
        C = 'C', 'TER C'

    year = models.PositiveIntegerField(unique=True)
    is_active = models.BooleanField(default=False)
    dtp_threshold = models.DecimalField(
        max_digits=14, decimal_places=2, default=Decimal('10000000'),
        help_text='THP di bawah/sama dengan nilai ini → PPh DTP (tidak dipotong riil).',
    )
    # Annual (Pasal 17) layer limits used by the December true-up (Tahap 3b).
    # Defaults are the statutory PP 55/2022 limits; editable as data.
    annual_layer_limits = models.JSONField(
        default=list,
        blank=True,
        help_text=(
            'Batas atas lapisan PKP tahunan (Pasal 17), mis. [60000000, '
            '250000000, 500000000, 5000000000]. Kosong = default 60jt/250jt/'
            '500jt/5M. Tarif lapisan 5/15/25/30% tetap (statis, PMK 168/2023).'
        ),
    )
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-year']
        verbose_name = 'Tax Config'
        verbose_name_plural = 'Tax Configs'

    def __str__(self):
        return f'TaxConfig {self.year} ({"aktif" if self.is_active else "nonaktif"})'

    def clean(self):
        limits = self.annual_layer_limits
        if limits:
            if not isinstance(limits, list) or len(limits) != 4:
                raise ValidationError(
                    {'annual_layer_limits': 'Harus berisi tepat 4 batas lapisan tahunan.'}
                )
            try:
                values = [Decimal(str(v)) for v in limits]
            except Exception:
                raise ValidationError(
                    {'annual_layer_limits': 'Batas lapisan harus angka.'}
                )
            for a, b in zip(values, values[1:]):
                if b <= a:
                    raise ValidationError(
                        {'annual_layer_limits': 'Batas lapisan harus naik (membesar).'}
                    )


class TerBracket(models.Model):
    """TER monthly rate table: one row per (year, category, bruto bracket)."""

    tax_config = models.ForeignKey(
        TaxConfig,
        on_delete=models.CASCADE,
        related_name='ter_brackets',
    )
    ter_category = models.CharField(max_length=1, choices=TaxConfig.TerCategory.choices)
    bruto_lower = models.DecimalField(max_digits=14, decimal_places=2)
    bruto_upper = models.DecimalField(
        max_digits=14, decimal_places=2, null=True, blank=True,
        help_text='NULL = tanpa batas atas (bracket tertinggi).',
    )
    rate_pct = models.DecimalField(
        max_digits=6, decimal_places=4,
        help_text='Persen tarif TER, mis. 0.2500 = 0,25%.',
    )

    class Meta:
        ordering = ['ter_category', 'bruto_lower']
        verbose_name = 'TER Bracket'
        verbose_name_plural = 'TER Brackets'

    def __str__(self):
        upper = self.bruto_upper if self.bruto_upper is not None else '∞'
        return f'{self.tax_config.year}-{self.ter_category}: {self.bruto_lower}-{upper} @ {self.rate_pct}%'


class AnnualTaxBracket(models.Model):
    """Annual progressive (Pasal 17) layer for the December true-up (Tahap 3b).

    Empty layer model for the 5%-35% annual rates: override a layer by adding a
    row (layer_order 1..5); missing layers fall back to the statutory defaults
    (5/15/25/30/35%). Stored as data so a future regulation change only needs a
    new row, like TerBracket (PRD 2.2 / 4.4).
    """

    tax_config = models.ForeignKey(
        TaxConfig,
        on_delete=models.CASCADE,
        related_name='annual_brackets',
    )
    layer_order = models.PositiveSmallIntegerField(
        help_text='Urutan lapisan PKP tahunan (1 = terendah, 5 = tertinggi).',
    )
    pkp_lower = models.DecimalField(
        max_digits=16, decimal_places=2,
        help_text='Batas bawah lapisan (indeks biaya 0).',
    )
    pkp_upper = models.DecimalField(
        max_digits=16, decimal_places=2, null=True, blank=True,
        help_text='Batas atas lapisan; NULL = tanpa batas (lapisan tertinggi).',
    )
    rate_pct = models.DecimalField(
        max_digits=6, decimal_places=4,
        help_text='Persen tarif Pasal 17, mis. 5 = 5%.',
    )

    class Meta:
        ordering = ['tax_config', 'layer_order']
        constraints = [
            models.UniqueConstraint(
                fields=['tax_config', 'layer_order'],
                name='uniq_annual_bracket_per_layer',
            ),
        ]
        verbose_name = 'Annual Tax Bracket'
        verbose_name_plural = 'Annual Tax Brackets'

    def __str__(self):
        upper = self.pkp_upper if self.pkp_upper is not None else '∞'
        return f'{self.tax_config.year} L{self.layer_order}: {self.pkp_lower}-{upper} @ {self.rate_pct}%'


class EmployeeTaxProfile(models.Model):
    """Per-employee tax attributes (PTKP status + scheme), editable by HR.

    The effective PTKP status used for a payroll run is snapshotted onto the
    Payroll row (ptkp_status_snapshot) for auditability — editing this profile
    never rewrites history (PRD 2.3).
    """

    class TaxScheme(models.TextChoices):
        NORMAL = 'NORMAL', 'Normal'
        GROSS_UP = 'GROSS_UP', 'Gross Up'

    employee = models.OneToOneField(
        'personnel.Employee',
        on_delete=models.CASCADE,
        related_name='tax_profile',
    )
    ptkp_status = models.CharField(max_length=4, default='TK/0')
    tax_scheme = models.CharField(
        max_length=16, choices=TaxScheme.choices, default=TaxScheme.NORMAL,
    )
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'Employee Tax Profile'
        verbose_name_plural = 'Employee Tax Profiles'

    def __str__(self):
        return f'{self.employee} — {self.ptkp_status} ({self.tax_scheme})'


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
    # Taxable earnings feed the PPh 21 TER base (PRD 4.2 "Kena Pajak?").
    is_taxable = models.BooleanField(default=True)
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
    # --- Tahap 3a engine fields ---
    # Snapshot of the PTKP status used for this run (history-safe, PRD 2.3).
    ptkp_status_snapshot = models.CharField(max_length=4, blank=True)
    ter_category_snapshot = models.CharField(max_length=1, blank=True)
    # Factor actually applied to basic salary this period (1 = full month).
    pro_rata_factor = models.DecimalField(max_digits=9, decimal_places=7, default=1)
    unpaid_leave_days = models.PositiveIntegerField(default=0)
    # --- Tahap 3b December true-up ---
    # Prior-month (Jan-Nov) SYSTEM PPh 21 sum snapshotted at December calc.
    pph_prior_months = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    # Annual PPh 21 (Pasal 17) computed for the full tax year.
    pph_annual = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    # December item amount = pph_annual - pph_prior_months (>= 0; overpayment is
    # a separate refund process outside this module).
    is_dtp = models.BooleanField(
        default=False,
        help_text='True = PPh DTP: tercetak di slip tapi tidak dikurangi dari transfer.',
    )
    # Nominal that Finance actually transfers (may differ from printed THP when DTP).
    transfer_amount = models.DecimalField(max_digits=14, decimal_places=2, default=0)
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
