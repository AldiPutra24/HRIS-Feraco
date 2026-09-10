"""Seed an inactive 2026 TER bracket template (illustrative rates, PMK 168/2023).

The bracket boundaries follow the published PMK 168/2023 structure, but the
RATE VALUES below are ILLUSTRATIVE. The config is created is_active=False on
purpose: HR/Admin must confirm the rates with the company's tax consultant,
edit via admin/API, and only then activate (PRD 2.2 warning).

Usage: python manage.py seed_tax_config
"""
from decimal import Decimal

from django.core.management.base import BaseCommand

from apps.payroll.models import TaxConfig, TerBracket

# (category, bruto_lower, bruto_upper or None, rate_pct) — ILLUSTRATIVE rates.
BRACKETS = [
    # TER A
    ('A', '0', '5400000', '0'),
    ('A', '5400000', '5650000', '0.25'),
    ('A', '5650000', '5950000', '0.5'),
    ('A', '5950000', '6300000', '0.75'),
    ('A', '6300000', '6750000', '1'),
    ('A', '6750000', '7500000', '1.25'),
    ('A', '7500000', '8550000', '1.5'),
    ('A', '8550000', '9650000', '1.75'),
    ('A', '9650000', '10050000', '2'),
    ('A', '10050000', '10350000', '2.25'),
    ('A', '10350000', '10800000', '2.5'),
    ('A', '10800000', '11350000', '3'),
    ('A', '11350000', '11850000', '3.5'),
    ('A', '11850000', '12400000', '4'),
    ('A', '12400000', '13100000', '5'),
    ('A', '13100000', '14000000', '6'),
    ('A', '14000000', '15150000', '7'),
    ('A', '15150000', '16650000', '8'),
    ('A', '16650000', '18850000', '9'),
    ('A', '18850000', '22150000', '10'),
    ('A', '22150000', '26850000', '11'),
    ('A', '26850000', '37350000', '15'),
    ('A', '37350000', '49350000', '18'),
    ('A', '49350000', '72350000', '20'),
    ('A', '72350000', '99850000', '22'),
    ('A', '99850000', None, '25'),
    # TER B
    ('B', '0', '6200000', '0'),
    ('B', '6200000', '6500000', '0.25'),
    ('B', '6500000', '6850000', '0.5'),
    ('B', '6850000', '7250000', '0.75'),
    ('B', '7250000', '7750000', '1'),
    ('B', '7750000', '8600000', '1.25'),
    ('B', '8600000', '9800000', '1.5'),
    ('B', '9800000', '11050000', '1.75'),
    ('B', '11050000', '11450000', '2'),
    ('B', '11450000', '11850000', '2.25'),
    ('B', '11850000', '12350000', '2.5'),
    ('B', '12350000', '12950000', '3'),
    ('B', '12950000', '13550000', '3.5'),
    ('B', '13550000', '14150000', '4'),
    ('B', '14150000', '14950000', '5'),
    ('B', '14950000', '15950000', '6'),
    ('B', '15950000', '17250000', '7'),
    ('B', '17250000', '18950000', '8'),
    ('B', '18950000', '21450000', '9'),
    ('B', '21450000', '25250000', '10'),
    ('B', '25250000', '30650000', '11'),
    ('B', '30650000', '42550000', '15'),
    ('B', '42550000', '56250000', '18'),
    ('B', '56250000', '82250000', '20'),
    ('B', '82250000', '113500000', '22'),
    ('B', '113500000', None, '25'),
    # TER C
    ('C', '0', '6600000', '0'),
    ('C', '6600000', '6950000', '0.5'),
    ('C', '6950000', '7350000', '1'),
    ('C', '7350000', '7850000', '1.5'),
    ('C', '7350000', '8450000', '2'),
    ('C', '8450000', '9250000', '2.5'),
    ('C', '9250000', '9650000', '3'),
    ('C', '9650000', '10150000', '4'),
    ('C', '10150000', '10550000', '5'),
    ('C', '10550000', '11050000', '6'),
    ('C', '11050000', '11600000', '7'),
    ('C', '11600000', '12200000', '8'),
    ('C', '12200000', '12950000', '9'),
    ('C', '12950000', '13850000', '10'),
    ('C', '13850000', '14950000', '11'),
    ('C', '14950000', '16250000', '15'),
    ('C', '16250000', '17850000', '16'),
    ('C', '17850000', '19650000', '17'),
    ('C', '19650000', '21750000', '18'),
    ('C', '21750000', '24350000', '19'),
    ('C', '24350000', '27450000', '20'),
    ('C', '27450000', '31350000', '21'),
    ('C', '31350000', '36600000', '22'),
    ('C', '36600000', '43200000', '23'),
    ('C', '43200000', '50900000', '24'),
    ('C', '50900000', None, '25'),
]


class Command(BaseCommand):
    help = (
        'Seed the 2026 tax config + TER bracket template (INACTIVE, illustrative '
        'rates — must be confirmed with the tax consultant before activating).'
    )

    def handle(self, *args, **options):
        config, created = TaxConfig.objects.get_or_create(
            year=2026,
            defaults={
                'is_active': False,
                'dtp_threshold': Decimal('10000000'),
                'notes': 'Template tarif TER (nilai ILUSTRATIF). Aktifkan hanya '
                         'setelah tarif dikonfirmasi ke konsultan pajak (PMK 168/2023).',
            },
        )
        if created:
            self.stdout.write('created: TaxConfig 2026 (is_active=False)')
        else:
            self.stdout.write('exists: TaxConfig 2026')

        existing = set(
            TerBracket.objects.filter(tax_config=config).values_list(
                'ter_category', 'bruto_lower', 'bruto_upper',
            )
        )
        created_count = 0
        for category, lower, upper, rate in BRACKETS:
            lower_d = Decimal(lower)
            upper_d = Decimal(upper) if upper else None
            if (category, lower_d, upper_d) in existing:
                continue
            TerBracket.objects.create(
                tax_config=config,
                ter_category=category,
                bruto_lower=lower_d,
                bruto_upper=upper_d,
                rate_pct=Decimal(rate),
            )
            created_count += 1
        self.stdout.write(f'brackets created: {created_count} (skipped existing)')
        self.stdout.write(self.style.WARNING(
            'Config is INACTIVE with illustrative rates — '
            'verify with the tax consultant, then set is_active=True.'
        ))
