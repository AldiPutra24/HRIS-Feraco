from django.db import transaction
from django.utils import timezone
from django.utils.crypto import get_random_string
from rest_framework.exceptions import ValidationError

from apps.audit.services import log_event
from apps.personnel.models import Employee, EmployeeContract

from .models import Onboarding, OnboardingStatusHistory, OnboardingChecklistItem, OnboardingDocument

# Default checklist items, created automatically when an onboarding is made.
DEFAULT_CHECKLIST = [
    ('DATA_BIODATA', 'Kelengkapan data biodata', 'Data', True, 10),
    ('DATA_KONTAK', 'Kelengkapan data kontak', 'Data', True, 20),
    ('DATA_FINANSIAL', 'Kelengkapan data finansial & legal', 'Data', True, 30),
    ('DATA_PEKERJAAN', 'Kelengkapan data pekerjaan', 'Data', True, 40),
    ('KTP', 'Penyerahan dokumen KTP', 'Dokumen', True, 50),
    ('KK', 'Penyerahan dokumen KK', 'Dokumen', True, 60),
    ('NPWP', 'Penyerahan NPWP', 'Dokumen', True, 70),
    ('BUKU_REKENING', 'Penyerahan buku rekening', 'Dokumen', True, 80),
    ('KONTRAK_KERJA', 'Penandatanganan kontrak kerja', 'Kontrak', True, 90),
]

# OnboardingData fields that must be filled before READY.
MANDATORY_DATA_FIELDS = [
    'full_name', 'nik', 'birth_place', 'birth_date', 'address', 'phone',
    'emergency_contact_name', 'emergency_contact_phone',
    'bank_account_number', 'bank_account_name', 'npwp',
    'bpjs_kesehatan', 'bpjs_ketenagakerjaan',
    'department', 'position', 'join_date', 'employment_type',
]

# Document types that must have an APPROVED doc before READY.
MANDATORY_DOCUMENT_TYPES = [
    OnboardingDocument.DocType.KTP,
    OnboardingDocument.DocType.KK,
    OnboardingDocument.DocType.NPWP,
    OnboardingDocument.DocType.BUKU_REKENING,
    OnboardingDocument.DocType.KONTRAK_KERJA,
]


def create_default_checklist(onboarding):
    """Create the standard checklist for a fresh onboarding."""
    for code, name, category, required, ordering in DEFAULT_CHECKLIST:
        OnboardingChecklistItem.objects.get_or_create(
            onboarding=onboarding,
            code=code,
            defaults={
                'name': name,
                'category': category,
                'required': required,
                'ordering': ordering,
            },
        )


def readiness_errors(onboarding):
    """List of human-readable blockers preventing DOCUMENT_REVIEW -> READY."""
    errors = []

    incomplete = onboarding.checklist_items.filter(required=True, completed=False)
    if incomplete.exists():
        errors.append('Checklist belum lengkap: ' + ', '.join(item.code for item in incomplete))

    missing_docs = []
    for doc_type in MANDATORY_DOCUMENT_TYPES:
        if not onboarding.documents.filter(document_type=doc_type, status='APPROVED').exists():
            missing_docs.append(doc_type)
    if missing_docs:
        errors.append('Dokumen wajib belum disetujui: ' + ', '.join(missing_docs))

    data = getattr(onboarding, 'data', None)
    missing_data = [
        f for f in MANDATORY_DATA_FIELDS
        if not getattr(data, f, None)
    ]
    if missing_data:
        errors.append('Data employment belum lengkap: ' + ', '.join(missing_data))

    return errors


# Checklist code -> predicate over (data, approved_doc_types).
# Source of truth: data completeness + approved documents. Manual override
# (explicit completed=True/False) is preserved unless this recomputes.
def _checklist_predicates(onboarding):
    data = getattr(onboarding, 'data', None)
    approved = set(
        onboarding.documents.filter(status='APPROVED').values_list('document_type', flat=True)
    )
    return {
        'DATA_BIODATA': bool(
            data and data.full_name and data.nik and data.birth_place
            and data.birth_date and data.address and data.phone
        ),
        'DATA_KONTAK': bool(
            data and data.emergency_contact_name and data.emergency_contact_phone
        ),
        'DATA_FINANSIAL': bool(
            data and data.bank_account_number and data.bank_account_name
            and data.npwp and data.bpjs_kesehatan and data.bpjs_ketenagakerjaan
        ),
        'DATA_PEKERJAAN': bool(
            data and data.department_id and data.position_id
            and data.join_date and data.employment_type
        ),
        'KTP': 'KTP' in approved,
        'KK': 'KK' in approved,
        'NPWP': 'NPWP' in approved,
        'BUKU_REKENING': 'BUKU_REKENING' in approved,
        'KONTRAK_KERJA': 'KONTRAK_KERJA' in approved,
    }


def sync_checklist(onboarding):
    """Recompute `completed` for checklist items from data + documents.

    Items explicitly marked complete stay complete; items whose underlying
    data/document is now satisfied are auto-completed. Items whose
    requirement is no longer met are reset. Returns number of changed items.
    """
    predicates = _checklist_predicates(onboarding)
    changed = 0
    for item in onboarding.checklist_items.all():
        should = predicates.get(item.code, item.completed)
        if should != item.completed:
            item.completed = should
            if should:
                item.completed_at = timezone.now()
            else:
                item.completed_at = None
            item.save(update_fields=['completed', 'completed_at'])
            changed += 1
    return changed


def transition_onboarding(onboarding, to_status, request, note=''):
    """Validate + apply a forward-only status transition.

    Returns (onboarding, history) on success, or (None, None) when the
    transition is not allowed. COMPLETED sets completed_at; CANCELLED keeps
    it untouched. DOCUMENT_REVIEW -> READY enforces readiness.
    COMPLETED is NOT allowed here — use complete_onboarding() instead.
    """
    allowed = Onboarding.TRANSITIONS.get(onboarding.status, set())
    if to_status not in allowed or to_status == onboarding.status:
        return None, None
    if to_status == 'READY':
        errors = readiness_errors(onboarding)
        if errors:
            raise ValidationError({'detail': errors})
    history = OnboardingStatusHistory.objects.create(
        onboarding=onboarding,
        from_status=onboarding.status,
        to_status=to_status,
        changed_by=request.user if request.user.is_authenticated else None,
        note=note,
    )
    onboarding.status = to_status
    if to_status == 'CANCELLED':
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


def _next_employee_id():
    """Generate unique employee_id: EMP-{year}-{sequential}."""
    from django.db.models import Max
    from django.utils import timezone
    year = timezone.now().year
    prefix = f'EMP-{year}-'
    last = Employee.objects.filter(employee_id__startswith=prefix).aggregate(
        m=Max('employee_id')
    )['m']
    if last:
        seq = int(last.split('-')[-1]) + 1
    else:
        seq = 1
    return f'{prefix}{seq:04d}'


@transaction.atomic
def complete_onboarding(onboarding, request):
    """Complete onboarding: create Employee, EmployeeContract, User account.

    Idempotent — safe to call multiple times. If onboarding already COMPLETED
    with an existing employee, returns the existing data.
    """
    from django.contrib.auth import get_user_model
    from django.utils import timezone

    from apps.accounts.models import Role

    User = get_user_model()

    # Guard: must be READY.
    if onboarding.status == 'COMPLETED':
        return onboarding
    if onboarding.status != 'READY':
        raise ValidationError(
            {'detail': 'Onboarding harus berstatus READY untuk dikompletasi.'}
        )

    # Validate readiness.
    errors = readiness_errors(onboarding)
    if errors:
        raise ValidationError({'detail': errors})

    data = onboarding.data
    if not data:
        raise ValidationError({'detail': 'Data onboarding belum diisi.'})

    # ── Create Employee (multi-table: Personnel + Employee) ──────────
    employee_id = _next_employee_id()
    employee = Employee.objects.create(
        full_name=data.full_name,
        nik=data.nik or '',
        birth_place=data.birth_place or '',
        birth_date=data.birth_date,
        address=data.address or '',
        phone=data.phone or '',
        personal_email=data.personal_email or '',
        emergency_contact_name=data.emergency_contact_name or '',
        emergency_contact_phone=data.emergency_contact_phone or '',
        bank_account_number=data.bank_account_number or '',
        bank_account_name=data.bank_account_name or '',
        npwp=data.npwp or '',
        bpjs_kesehatan=data.bpjs_kesehatan or '',
        bpjs_ketenagakerjaan=data.bpjs_ketenagakerjaan or '',
        employee_id=employee_id,
        department=data.department,
        position=data.position,
        join_date=data.join_date,
        employment_status='ACTIVE',
    )

    # ── Create EmployeeContract ──────────────────────────────────────
    contract_number = f'CTR-{employee_id}'
    contract = EmployeeContract.objects.create(
        employee=employee,
        contract_type=data.employment_type,
        contract_number=contract_number,
        start_date=data.join_date or timezone.now().date(),
        end_date=(
            None if data.employment_type == 'PKWTT'
            else (data.join_date or timezone.now().date()).replace(
                year=(data.join_date or timezone.now().date()).year + 1
            )
        ),
        probation_enabled=data.probation_enabled if data.employment_type == 'PKWTT' else False,
        probation_start_date=data.probation_start_date if data.employment_type == 'PKWTT' else None,
        probation_end_date=data.probation_end_date if data.employment_type == 'PKWTT' else None,
        status='ACTIVE',
    )

    # ── Create User account (EMPLOYEE role) ─────────────────────────
    emp_role = Role.objects.filter(key=Role.EMPLOYEE).first()
    username = (data.personal_email or data.full_name.replace(' ', '').lower())[:150]
    user = User.objects.create_user(
        username=username,
        email=data.personal_email or '',
        first_name=data.full_name,
        password=get_random_string(length=16),
    )
    user.role = emp_role
    user.save(update_fields=['role'])

    # Link user to Employee (via Personnel.user).
    employee.user = user
    employee.save(update_fields=['user', 'updated_at'])

    # ── Finalize onboarding ─────────────────────────────────────────
    onboarding.status = 'COMPLETED'
    onboarding.completed_at = timezone.now()
    onboarding.completed_by = request.user if request.user.is_authenticated else None
    onboarding.employee = employee
    onboarding.save(update_fields=[
        'status', 'completed_at', 'completed_by', 'employee', 'updated_at',
    ])

    OnboardingStatusHistory.objects.create(
        onboarding=onboarding,
        from_status='READY',
        to_status='COMPLETED',
        changed_by=request.user if request.user.is_authenticated else None,
        note='Onboarding completed — Employee, Contract, and Account created.',
    )

    log_event(
        request,
        'create',
        obj=employee,
        description=(
            f'Employee created from onboarding "{onboarding.candidate.full_name}": '
            f'{employee_id}'
        ),
    )
    log_event(
        request,
        'create',
        obj=employee,
        description=(
            f'Contract {contract_number} ({data.employment_type}) created for '
            f'{employee_id}'
        ),
    )
    log_event(
        request,
        'create',
        obj=employee,
        description=(
            f'User account created for employee {employee_id}'
        ),
    )
    log_event(
        request,
        'update',
        obj=onboarding,
        description=(
            f'Onboarding "{onboarding.candidate.full_name}" completed — '
            f'Employee #{employee_id}'
        ),
    )

    return onboarding
