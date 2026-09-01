from django.core.management.base import BaseCommand

from apps.leaves.models import LeaveType

# (code, name, kind, default_quota, max_days_per_request, min_tenure_months,
#  max_days_without_attachment, carry_forward_max, deducts_from_code, is_paid,
#  requires_attachment, description)
LEAVE_TYPES = [
    (
        'ANNUAL', 'Cuti Tahunan', 'LEAVE', 12, 3, 3, 0, 3, None, True, False,
        'Hak mulai setelah masa kerja 3 bulan; 1 hari/bulan sisa tahun berjalan, '
        '12 hari kerja/tahun berikutnya; maks 3 hari berturut-turut; carry forward maks 3 hari.',
    ),
    (
        'MATERNITY', 'Cuti Melahirkan', 'LEAVE', 0, 90, 0, 0, 0, None, True, False,
        '3 bulan, dapat diperpanjang maks 3 bulan dengan kondisi khusus dan surat dokter.',
    ),
    (
        'MARRIAGE', 'Cuti Menikah', 'LEAVE', 0, 3, 0, 0, 0, None, True, False,
        'Special leave, durasi 3 hari.',
    ),
    (
        'MISCARRIAGE', 'Cuti Keguguran', 'LEAVE', 0, 45, 0, 0, 0, None, True, True,
        '1,5 bulan atau sesuai surat dokter kandungan/bidan.',
    ),
    (
        'MEDICAL', 'Cuti Berobat', 'LEAVE', 0, 0, 0, 0, 0, 'ANNUAL', True, False,
        'Lab, check-up, kontrol; wajib beri tahu H-1 ke User dan HR; dihitung sebagai Cuti Tahunan.',
    ),
    (
        'VACCINE', 'Cuti Vaksin', 'LEAVE', 0, 1, 0, 0, 0, None, True, False,
        'Durasi 1/2 hari, terencana.',
    ),
    (
        'PATERNITY', 'Cuti Paternity', 'LEAVE', 0, 3, 0, 0, 0, None, True, False,
        'Pendampingan istri melahirkan/keguguran; 2 hari, maks 3 hari dengan persetujuan manajemen.',
    ),
    (
        'CHILD_CIRCUMCISION', 'Cuti Anak Karyawan Khitan', 'LEAVE', 0, 2, 0, 0, 0, None, True, False,
        'Durasi 2 hari.',
    ),
    (
        'SPECIAL', 'Cuti Special Leave', 'LEAVE', 0, 0, 0, 0, 0, None, True, False,
        'Cuti Tukar Hari, pendamping istri melahirkan/keguguran, keluarga dirawat inap, '
        'keluarga meninggal, cuti haji, dan ketentuan khusus lain sesuai approval management. '
        'Detail alasan diisi pada kolom alasan.',
    ),
]

PERMISSION_TYPES = [
    (
        'SICK', 'Izin Sakit', 'PERMISSION', 0, 0, 0, 1, 0, None, False, False,
        '1 hari tanpa surat dokter; termasuk cuti haid/dismenore; >1 hari membutuhkan surat dokter.',
    ),
    (
        'FAMILY', 'Izin Kepentingan Keluarga', 'PERMISSION', 0, 0, 0, 0, 0, None, False, False,
        'Izin untuk kepentingan keluarga.',
    ),
    (
        'PERSONAL', 'Izin Pribadi', 'PERMISSION', 0, 0, 0, 0, 0, None, False, False,
        'Izin untuk keperluan pribadi.',
    ),
    (
        'LATE', 'Izin Keterlambatan', 'PERMISSION', 0, 0, 0, 0, 0, None, False, False,
        'Izin datang terlambat / meninggalkan pekerjaan sebelum waktu kerja selesai.',
    ),
]

# Cuti Tidak Berbayar - no separate category; employees select a LEAVE category
# and note the unpaid nature in the reason field. Handled by HR when approving.
UNPAID_NOTE = (
    'Cuti Tidak Berbayar tidak memiliki kategori sendiri: mangkir, keperluan pribadi di luar '
    'kategori, sakit >1 hari tanpa surat dokter, dan alasan lain di luar cuti berbayar diajukan '
    'melalui kategori yang relevan dengan catatan pada alasan.'
)


class Command(BaseCommand):
    help = 'Seed default leave/permission categories with HR business rules (idempotent).'

    def handle(self, *args, **options):
        for row in LEAVE_TYPES + PERMISSION_TYPES:
            self._upsert(*row)
        self.stdout.write('NOTE: ' + UNPAID_NOTE)

    def _upsert(self, code, name, kind, quota, max_days, min_tenure,
                max_no_attach, carry, deducts_from, is_paid, requires_attachment, description):
        data = {
            'name': name,
            'kind': kind,
            'is_active': True,
            'default_quota': quota,
            'max_days_per_request': max_days or None,
            'min_tenure_months': min_tenure or None,
            'max_days_without_attachment': max_no_attach,
            'carry_forward_max': carry,
            'is_paid': is_paid,
            'requires_attachment': requires_attachment,
            'description': description,
        }
        obj, created = LeaveType.objects.get_or_create(code=code, defaults=data)
        if not created:
            # Re-point deducts_from after creation (self-referential FK).
            changed = [f for f, v in data.items() if getattr(obj, f) != v]
            if deducts_from:
                target = LeaveType.objects.filter(code=deducts_from).first()
                if target and obj.deducts_from_id != target.id:
                    obj.deducts_from = target
                    changed.append('deducts_from')
            if changed:
                for f in changed:
                    if f != 'deducts_from':
                        setattr(obj, f, data[f])
                obj.save(update_fields=changed)
                self.stdout.write(f'updated: {code} ({", ".join(changed)})')
            else:
                self.stdout.write(f'exists: {code}')
        else:
            if deducts_from:
                target = LeaveType.objects.filter(code=deducts_from).first()
                if target:
                    obj.deducts_from = target
                    obj.save(update_fields=['deducts_from'])
            self.stdout.write(f'created: {code}')
