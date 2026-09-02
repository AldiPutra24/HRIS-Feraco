from django.core.management.base import BaseCommand

from apps.payroll.models import PayrollComponent

# (code, name, category, calculation_type, default_amount, is_paid_component,
#  is_reimbursement, sort_order, description)
COMPONENTS = [
    # Gaji Pokok
    ('BASIC', 'Gaji Pokok', 'EARNING_FIXED', 'FIXED_AMOUNT', None, False, 1,
     'Gaji pokok karyawan.'),
    # Tunjangan Tetap
    ('ALLOW_TRANSPORT', 'Tunjangan Transport', 'EARNING_FIXED', 'FIXED_AMOUNT', None, False, 10,
     'Tunjangan transport tetap.'),
    ('ALLOW_MEAL', 'Tunjangan Makan', 'EARNING_FIXED', 'FIXED_AMOUNT', None, False, 11,
     'Tunjangan makan tetap.'),
    ('ALLOW_POSITION', 'Tunjangan Jabatan', 'EARNING_FIXED', 'FIXED_AMOUNT', None, False, 12,
     'Tunjangan jabatan tetap.'),
    # Tunjangan Tidak Tetap
    ('OVERTIME', 'Lembur', 'EARNING_VARIABLE', 'VARIABLE', None, False, 20,
     'Uang lembur, dihitung per periode.'),
    ('INCENTIVE', 'Insentif', 'EARNING_VARIABLE', 'VARIABLE', None, False, 21,
     'Insentif periodik.'),
    ('BONUS', 'Bonus', 'EARNING_VARIABLE', 'VARIABLE', None, False, 22,
     'Bonus, diberikan sewaktu-waktu.'),
    # Reimbursement (merge ke payroll)
    ('REIMBURSEMENT', 'Reimbursement', 'EARNING_VARIABLE', 'VARIABLE', None, True, 30,
     'Reimbursement yang digabung ke payroll.'),
    # Potongan
    ('BPJS_KS', 'BPJS Kesehatan', 'DEDUCTION', 'PERCENTAGE', None, False, 40,
     'Potongan BPJS Kesehatan (persentase ditentukan di tahap perhitungan).'),
    ('BPJS_TK', 'BPJS Ketenagakerjaan', 'DEDUCTION', 'PERCENTAGE', None, False, 41,
     'Potongan BPJS Ketenagakerjaan (persentase ditentukan di tahap perhitungan).'),
    ('PPh21', 'PPh 21', 'DEDUCTION', 'PERCENTAGE', None, False, 42,
     'Potongan Pajak Penghasilan 21.'),
    ('LOAN', 'Pinjaman / Kasbon', 'DEDUCTION', 'FIXED_AMOUNT', None, False, 43,
     'Potongan pinjaman/kasbon.'),
    ('LATE_FEE', 'Denda Keterlambatan', 'DEDUCTION', 'FIXED_AMOUNT', None, False, 44,
     'Denda keterlambatan.'),
]


class Command(BaseCommand):
    help = 'Seed default payroll components (idempotent).'

    def handle(self, *args, **options):
        for code, name, category, calc, amount, is_reimb, order, desc in COMPONENTS:
            obj, created = PayrollComponent.objects.get_or_create(
                code=code,
                defaults={
                    'name': name,
                    'category': category,
                    'calculation_type': calc,
                    'default_amount': amount,
                    'is_reimbursement': is_reimb,
                    'sort_order': order,
                    'description': desc,
                    'is_active': True,
                },
            )
            if created:
                self.stdout.write(f'created: {code}')
            else:
                # Refresh config fields on re-run (idempotent upsert).
                changed = []
                for field, value in [
                    ('name', name),
                    ('category', category),
                    ('calculation_type', calc),
                    ('default_amount', amount),
                    ('is_reimbursement', is_reimb),
                    ('sort_order', order),
                    ('description', desc),
                ]:
                    if getattr(obj, field) != value:
                        setattr(obj, field, value)
                        changed.append(field)
                if changed:
                    obj.save(update_fields=changed)
                    self.stdout.write(f'updated: {code} ({", ".join(changed)})')
                else:
                    self.stdout.write(f'exists: {code}')
