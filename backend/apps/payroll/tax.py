"""PPh 21 TER helpers (Tahap 3a).

Rates come from the TaxConfig/TerBracket tables (PMK 168/2023 data loaded by
HR) — nothing here is hardcoded. All money math uses Decimal; PPh amounts are
rounded DOWN to the nearest thousand rupiah (pembulatan ke bawah ribuan
penuh).
"""
from decimal import Decimal, ROUND_DOWN

from django.db.models import Q

from .models import PayrollComponent, TaxConfig, TerBracket

THOUSAND = Decimal('1000')


class TaxConfigError(Exception):
    """Raised when the tax configuration for a year is missing or incomplete."""


# PTKP status -> TER category (PRD 2.5, fixed government classification).
TER_CATEGORY_MAP = {
    'TK/0': 'A', 'TK/1': 'A', 'K/0': 'A',
    'TK/2': 'B', 'TK/3': 'B', 'K/1': 'B', 'K/2': 'B',
    'K/3': 'C',
}

VALID_PTKP = set(TER_CATEGORY_MAP.keys())


def ter_category_for(ptkp_status):
    """PTKP status code (TK/0 .. K/3) -> TER category A/B/C."""
    category = TER_CATEGORY_MAP.get((ptkp_status or '').strip().upper())
    if category is None:
        raise TaxConfigError(f'Status PTKP tidak dikenal: {ptkp_status!r}')
    return category


def get_active_config(year):
    """Active TaxConfig for a tax year, or raise TaxConfigError."""
    config = TaxConfig.objects.filter(year=year, is_active=True).first()
    if config is None:
        raise TaxConfigError(
            f'Konfigurasi pajak untuk tahun {year} belum tersedia/aktif. '
            'Hubungi Admin/HR untuk mengisi tabel tarif TER.'
        )
    return config


def ter_rate(config, ter_category, bruto):
    """TER rate (Decimal percent, e.g. Decimal('0.25') = 0.25%) for a bruto amount."""
    bracket = TerBracket.objects.filter(
        tax_config=config,
        ter_category=ter_category,
        bruto_lower__lte=bruto,
    ).filter(
        Q(bruto_upper__isnull=True) | Q(bruto_upper__gte=bruto),
    ).order_by('-bruto_lower').first()
    if bracket is None:
        raise TaxConfigError(
            f'Tabel TER {config.year} kategori {ter_category} tidak mencakup bruto {bruto}.'
        )
    return bracket.rate_pct


def round_pph(amount):
    """PPh 21 is rounded DOWN to the nearest thousand rupiah."""
    return (amount / THOUSAND).to_integral_value(rounding=ROUND_DOWN) * THOUSAND


def compute_monthly_pph21(config, ptkp_status, bruto):
    """Monthly TER PPh 21 (Jan-Nov): bruto x rate, rounded down to 1000s."""
    category = ter_category_for(ptkp_status)
    rate_pct = ter_rate(config, category, bruto)
    pph = bruto * rate_pct / Decimal('100')
    return round_pph(pph), category, rate_pct


def is_taxable_code(code):
    """Component codes excluded from the taxable TER base."""
    return not (code or '').upper().startswith('REIMBURSEMENT')


def taxable_earning_items(items):
    """Filter payroll item dicts to taxable earnings (by component is_taxable)."""
    out = []
    for item in items:
        if item['category'] == PayrollComponent.Category.DEDUCTION:
            continue
        comp = PayrollComponent.objects.filter(code=item['code']).first()
        if comp is not None and not comp.is_taxable:
            continue
        if comp is None and not is_taxable_code(item['code']):
            continue
        out.append(item)
    return out
