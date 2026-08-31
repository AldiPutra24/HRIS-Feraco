from django.db import models
from django.utils import timezone

from apps.accounts.models import User


class Department(models.Model):
    name = models.CharField(max_length=128, unique=True)
    code = models.CharField(max_length=32, blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['name']

    def __str__(self):
        return self.name


class Position(models.Model):
    name = models.CharField(max_length=128)
    department = models.ForeignKey(
        Department,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='positions',
    )
    parent_position = models.ForeignKey(
        'self',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='children',
    )
    code = models.CharField(max_length=32, blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['name']
        unique_together = ('name', 'department')

    def __str__(self):
        return self.name


class Personnel(models.Model):
    """Base entity shared by Employee and Freelancer (biodata + contact)."""

    class Status(models.TextChoices):
        ACTIVE = 'ACTIVE', 'Active'
        INACTIVE = 'INACTIVE', 'Inactive'
        TERMINATED = 'TERMINATED', 'Terminated'

    user = models.OneToOneField(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='personnel',
    )
    full_name = models.CharField(max_length=255)
    nik = models.CharField(max_length=32, unique=True, null=True, blank=True)
    birth_place = models.CharField(max_length=128, blank=True)
    birth_date = models.DateField(null=True, blank=True)
    address = models.TextField(blank=True)
    phone = models.CharField(max_length=32, blank=True)
    personal_email = models.EmailField(blank=True)
    company_email = models.EmailField(blank=True)
    emergency_contact_name = models.CharField(max_length=255, blank=True)
    emergency_contact_phone = models.CharField(max_length=32, blank=True)
    bank_account_number = models.CharField(max_length=64, blank=True)
    bank_account_name = models.CharField(max_length=255, blank=True)
    npwp = models.CharField(max_length=32, blank=True)
    bpjs_kesehatan = models.CharField(max_length=32, blank=True)
    bpjs_ketenagakerjaan = models.CharField(max_length=32, blank=True)
    status = models.CharField(
        max_length=16,
        choices=Status.choices,
        default=Status.ACTIVE,
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['full_name']
        verbose_name_plural = 'personnel'

    def __str__(self):
        return self.full_name


class Employee(Personnel):
    EMPLOYMENT_CHOICES = [
        ('ACTIVE', 'Active'),
        ('INACTIVE', 'Inactive'),
    ]

    employee_id = models.CharField(max_length=32, unique=True)
    department = models.ForeignKey(
        Department,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='employees',
    )
    position = models.ForeignKey(
        Position,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='employees',
    )
    manager = models.ForeignKey(
        'self',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='reports',
    )
    join_date = models.DateField(null=True, blank=True)
    employment_status = models.CharField(max_length=16, choices=EMPLOYMENT_CHOICES, default='ACTIVE')


class EmployeeContract(models.Model):
    CONTRACT_CHOICES = [
        ('PKWT', 'PKWT'),
        ('PKWTT', 'PKWTT'),
    ]
    STATUS_CHOICES = [
        ('DRAFT', 'Draft'),
        ('ACTIVE', 'Active'),
        ('EXPIRED', 'Expired'),
        ('TERMINATED', 'Terminated'),
        ('RENEWED', 'Renewed'),
    ]

    employee = models.ForeignKey(Employee, on_delete=models.CASCADE, related_name='contracts')
    contract_type = models.CharField(max_length=16, choices=CONTRACT_CHOICES)
    contract_number = models.CharField(max_length=64, unique=True, null=True, blank=True)
    start_date = models.DateField()
    end_date = models.DateField(null=True, blank=True)
    probation_enabled = models.BooleanField(default=False)
    probation_start_date = models.DateField(null=True, blank=True)
    probation_end_date = models.DateField(null=True, blank=True)
    status = models.CharField(max_length=16, choices=STATUS_CHOICES, default='DRAFT')
    termination_date = models.DateField(null=True, blank=True)
    termination_reason = models.TextField(blank=True)
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    deleted_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['-start_date']

    def __str__(self):
        return f'{self.employee} - {self.contract_number or self.contract_type}'

    @property
    def is_current(self):
        """Current = ACTIVE and its period still valid (PKWTT has no end)."""
        if self.status != 'ACTIVE':
            return False
        return self.end_date is None or self.end_date >= timezone.localdate()


class EmploymentHistory(models.Model):
    HISTORY_CHOICES = [
        ('PROMOTION', 'Promotion'),
        ('TRANSFER', 'Transfer'),
        ('POSITION_CHANGE', 'Position Change'),
    ]

    employee = models.ForeignKey(Employee, on_delete=models.CASCADE, related_name='history')
    date = models.DateField()
    history_type = models.CharField(max_length=16, choices=HISTORY_CHOICES)
    previous_department = models.ForeignKey(Department, on_delete=models.SET_NULL, null=True, blank=True, related_name='+')
    previous_position = models.ForeignKey(Position, on_delete=models.SET_NULL, null=True, blank=True, related_name='+')
    new_department = models.ForeignKey(Department, on_delete=models.SET_NULL, null=True, blank=True, related_name='+')
    new_position = models.ForeignKey(Position, on_delete=models.SET_NULL, null=True, blank=True, related_name='+')
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-date']
        verbose_name_plural = 'employment histories'

    def __str__(self):
        return f'{self.employee} - {self.history_type}'


class EmployeeDocument(models.Model):
    """Metadata for files stored in Supabase Storage (binary never in DB)."""

    employee = models.ForeignKey(Employee, on_delete=models.CASCADE, related_name='documents')
    contract = models.ForeignKey(EmployeeContract, on_delete=models.SET_NULL, null=True, blank=True, related_name='documents')
    name = models.CharField(max_length=255)
    storage_path = models.CharField(max_length=512)
    content_type = models.CharField(max_length=128, blank=True)
    size = models.PositiveBigIntegerField(default=0)
    version = models.PositiveIntegerField(default=1)
    uploaded_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name='uploaded_documents')
    created_at = models.DateTimeField(auto_now_add=True)
    deleted_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return self.name


class Freelancer(Personnel):
    contact_person = models.CharField(max_length=255, blank=True)
    rate = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)