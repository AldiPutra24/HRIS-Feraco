"""Employee self-service personal data.

Two kinds of fields:
  - SELF_EDIT_FIELDS: low-risk contact data the employee edits directly.
  - REQUEST_FIELDS: legal / payroll / tax data changed only through an
    EmployeeChangeRequest approved by HR Staff, HR Lead or Admin.
Everything else on Employee (department, position, manager, company email,
...) is HR-only and cannot be requested.

Values are validated with the same EmployeeSerializer HR uses, both when the
request is submitted and again when it is approved (data may have changed).
"""
from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from .storage import inline_content_type, upload_bytes

SELF_EDIT_FIELDS = {
    'address': 'Alamat',
    'phone': 'Nomor Telepon',
    'personal_email': 'Email Pribadi',
    'emergency_contact_name': 'Kontak Darurat',
    'emergency_contact_phone': 'Nomor Kontak Darurat',
}

REQUEST_FIELDS = {
    'full_name': 'Nama Lengkap',
    'nik': 'NIK',
    'birth_place': 'Tempat Lahir',
    'birth_date': 'Tanggal Lahir',
    'bank_account_number': 'Nomor Rekening',
    'bank_account_name': 'Nama Pemilik Rekening',
    'npwp': 'NPWP',
    'bpjs_kesehatan': 'BPJS Kesehatan',
    'bpjs_ketenagakerjaan': 'BPJS Ketenagakerjaan',
    'marital_status': 'Status Pernikahan',
    'religion': 'Agama',
    'gender': 'Jenis Kelamin',
}

# A supporting document is mandatory when any of these fields is requested.
ATTACHMENT_REQUIRED_FIELDS = {
    'full_name', 'nik', 'birth_place', 'birth_date',            # KTP
    'bank_account_number', 'bank_account_name',                  # buku tabungan
    'npwp', 'bpjs_kesehatan', 'bpjs_ketenagakerjaan',            # kartu
    'marital_status',                                            # buku nikah / KK
}

# Masked for non-HR viewers (same fields EmployeeReadSerializer masks).
SENSITIVE_FIELDS = {'nik', 'bank_account_number', 'npwp', 'bpjs_kesehatan', 'bpjs_ketenagakerjaan'}

BANK_FIELDS = {'bank_account_number', 'bank_account_name'}

APPROVER_ROLES = {'ADMIN', 'HR_STAFF', 'HR_LEAD'}

ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024
ATTACHMENT_BUCKET = 'employee-documents'


def _as_text(value):
    if value is None:
        return ''
    if hasattr(value, 'isoformat'):
        return value.isoformat()
    return str(value)


def _validated(employee, data):
    """Validate `data` with EmployeeSerializer (partial) -> validated dict."""
    from .serializers import EmployeeSerializer

    serializer = EmployeeSerializer(employee, data=data, partial=True)
    if not serializer.is_valid():
        raise ValidationError(serializer.errors)
    return serializer


def apply_self_edit(employee, data):
    """Directly update SELF_EDIT_FIELDS. Returns {field: (old, new)} changed."""
    unknown = sorted(set(data) - set(SELF_EDIT_FIELDS))
    if unknown:
        labels = ', '.join(REQUEST_FIELDS.get(f, f) for f in unknown)
        raise ValidationError({'detail': f'Field berikut tidak dapat diubah langsung: {labels}. '
                                         'Gunakan Ajukan Perubahan.'})
    clean = {f: ('' if v is None else str(v).strip()) for f, v in data.items()}
    changed = {f: (_as_text(getattr(employee, f)), v) for f, v in clean.items()
               if _as_text(getattr(employee, f)) != v}
    if not changed:
        return {}
    serializer = _validated(employee, {f: new for f, (_, new) in changed.items()})
    serializer.save()
    return changed


def _check_attachment(upload):
    if upload.size > ATTACHMENT_MAX_BYTES:
        raise ValidationError({'attachment': 'Dokumen pendukung maksimal 5 MB.'})
    data = upload.read()
    # Real bytes decide (never the client content type): PDF / JPG / PNG / WEBP.
    if inline_content_type(data[:16]) is None:
        raise ValidationError({'attachment': 'Dokumen pendukung harus PDF atau gambar (JPG, PNG, WEBP).'})
    return data


def create_change_request(employee, user, changes, note='', upload=None):
    """Create a PENDING request for REQUEST_FIELDS (values validated now)."""
    from .models import EmployeeChangeRequest

    if not isinstance(changes, dict) or not changes:
        raise ValidationError({'changes': 'Pilih minimal satu data yang ingin diubah.'})
    unknown = sorted(set(changes) - set(REQUEST_FIELDS))
    if unknown:
        raise ValidationError({'changes': f'Field tidak dapat diajukan: {", ".join(unknown)}.'})
    clean = {f: ('' if v is None else str(v).strip()) for f, v in changes.items()}
    same = [REQUEST_FIELDS[f] for f, v in clean.items() if _as_text(getattr(employee, f)) == v]
    if same:
        raise ValidationError({'changes': f'Nilai baru sama dengan data saat ini: {", ".join(same)}.'})
    pending = set()
    for cr in EmployeeChangeRequest.objects.filter(employee=employee, status='PENDING'):
        pending |= set(cr.changes)
    busy = [REQUEST_FIELDS[f] for f in clean if f in pending]
    if busy:
        raise ValidationError({'changes': f'Masih ada pengajuan yang menunggu persetujuan untuk: {", ".join(busy)}.'})
    validated = _validated(employee, clean).validated_data
    if ATTACHMENT_REQUIRED_FIELDS & set(clean) and upload is None:
        raise ValidationError({'attachment': 'Dokumen pendukung wajib dilampirkan (mis. KTP, buku tabungan, '
                                             'kartu NPWP/BPJS, buku nikah/KK).'})
    data = _check_attachment(upload) if upload is not None else None

    with transaction.atomic():
        cr = EmployeeChangeRequest.objects.create(
            employee=employee,
            requested_by=user,
            note=(note or '').strip(),
            changes={f: {'old': _as_text(getattr(employee, f)), 'new': _as_text(validated.get(f, clean[f]))}
                     for f in clean},
        )
        if data is not None:
            path = f'change-requests/{employee.pk}/{cr.pk}-{upload.name}'
            try:
                upload_bytes(ATTACHMENT_BUCKET, path, data, content_type=upload.content_type or 'application/octet-stream')
            except Exception as exc:
                raise ValidationError({'attachment': f'Upload dokumen gagal: {str(exc)[:120]}'}) from exc
            cr.attachment_name = upload.name
            cr.attachment_path = path
            cr.attachment_content_type = upload.content_type or ''
            cr.save(update_fields=['attachment_name', 'attachment_path', 'attachment_content_type', 'updated_at'])
    return cr


def approve_change_request(cr, reviewer):
    """Apply the requested values (re-validated) and mark APPROVED.
    Returns (before, after) dicts of the applied fields."""
    from .serializers import EmployeeSerializer

    employee = cr.employee
    new_values = {f: v['new'] for f, v in cr.changes.items()}
    before = {f: _as_text(getattr(employee, f)) for f in new_values}
    serializer = EmployeeSerializer(employee, data=new_values, partial=True)
    if not serializer.is_valid():
        raise ValidationError({'detail': 'Data pengajuan sudah tidak valid, tolak pengajuan ini.', **serializer.errors})
    with transaction.atomic():
        serializer.save()
        cr.status = 'APPROVED'
        cr.reviewed_by = reviewer
        cr.reviewed_at = timezone.now()
        cr.save(update_fields=['status', 'reviewed_by', 'reviewed_at', 'updated_at'])
    after = {f: _as_text(getattr(employee, f)) for f in new_values}
    return before, after


def mask(field, value, privileged):
    """Same masking as EmployeeReadSerializer for non-HR viewers."""
    from .serializers import _mask

    if field not in SENSITIVE_FIELDS:
        return value
    return _mask(value, privileged)
