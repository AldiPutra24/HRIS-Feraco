"""PPh 21 helpers (Tahap 3a monthly TER + Tahap 3b December true-up).

Rates come from the TaxConfig/TerBracket tables (PMK 168/2023 data loaded by
HR) — nothing here is hardcoded. All money math uses Decimal; PPh amounts are
rounded DOWN to the nearest thousand rupiah (pembulatan ke bawah ribuan
penuh).

December true-up (PMK 168/2023 Pasal 15 ayat (1) huruf c, for TER category
employees): the December withholding is the annual PPh 21 computed on the
FULL YEAR — (gross yearly earnings − biaya jabatan − iuran pensiun − PTKP) ×
progressive Pasal 17 layers (5–35%) — minus the PPh 21 already withheld
January–November. Biaya jabatan is 5% of gross, capped at Rp500.000/month
(Rp6.000.000/year). Indexing (indeks biaya 0) on the layer limits is NOT
applied — limits are used at cost index 0.
"""
from decimal import Decimal, ROUND_DOWN

from django.db.models import Q

from .models import AnnualTaxBracket, PayrollComponent, TaxConfig, TerBracket

THOUSAND = Decimal('1000')

# Statutory Pasal 17 annual layer limits (cost index 0). Editable per year via
# TaxConfig.annual_layer_limits; the percentages stay fixed by law.
DEFAULT_ANNUAL_LAYER_LIMITS = (
    Decimal('60000000'),      # 60 jt  -> 5%
    Decimal('250000000'),     # 250 jt -> 15%
    Decimal('500000000'),     # 500 jt -> 25%
    Decimal('5000000000'),    # 5 M    -> 30%
    # above -> 35%
)
DEFAULT_ANNUAL_LAYER_RATES = (
    Decimal('5'), Decimal('15'), Decimal('25'), Decimal('30'), Decimal('35'),
)

# 5% of gross, max Rp500.000/month (PRD/PPh 21 biaya jabatan).
BIAYA_JABATAN_PCT = Decimal('5')
BIAYA_JABATAN_MONTHLY_CAP = Decimal('500000')
BIAYA_JABATAN_ANNUAL_CAP = BIAYA_JABATAN_MONTHLY_CAP * Decimal('12')

# Annual PTKP (unchanged since 2016, PRD 2.3).
PTKP_ANNUAL = {
    'TK/0': Decimal('54000000'), 'TK/1': Decimal('58500000'),
    'TK/2': Decimal('63000000'), 'TK/3': Decimal('67500000'),
    'K/0': Decimal('58500000'), 'K/1': Decimal('63000000'),
    'K/2': Decimal('67500000'), 'K/3': Decimal('72000000'),
}


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


def biaya_jabatan(gross_year):
    """Occupational expense: 5% of annual gross, max Rp6.000.000 (5% × 500rb).

    A full month of employment contributes at most Rp500.000; the annual cap
    is Rp6.000.000. Mid-month windows are handled by the caller (see
    biaya_jabatan_with_months).
    """
    amount = gross_year * BIAYA_JABATAN_PCT / Decimal('100')
    return min(amount, BIAYA_JABATAN_ANNUAL_CAP)


def biaya_jabatan_with_months(gross_year, months_worked):
    """Biaya jabatan capped at Rp500.000 per month actually worked.

    PMK 168/2023: for employees who did not work a full year, biaya jabatan is
    computed per month of employment (5% × gross for that month, max 500rb).
    `months_worked` counts paid employment months in the tax year (fractional
    months count proportionally, e.g. joining on the 10th of a 30-day month →
    21/30 of a month).
    """
    amount = gross_year * BIAYA_JABATAN_PCT / Decimal('100')
    capped = BIAYA_JABATAN_MONTHLY_CAP * months_worked
    return min(amount, capped, BIAYA_JABATAN_ANNUAL_CAP)


def _annual_layers(config):
    """Annual (Pasal 17) layers as a list of (pkp_lower, pkp_upper|None, rate).

    Layers come from AnnualTaxBracket rows when present; missing layers fall
    back to the statutory defaults so a config with no rows still yields the
    standard 5/15/25/30/35% table.
    """
    overrides = {
        b.layer_order: (b.pkp_lower, b.pkp_upper, b.rate_pct)
        for b in config.annual_brackets.all()
    }
    limits = config.annual_layer_limits or list(DEFAULT_ANNUAL_LAYER_LIMITS)
    if len(limits) != 4:
        raise TaxConfigError(
            f'annual_layer_limits tahun {config.year} harus berisi 4 batas lapisan.'
        )
    layers = []
    lower = Decimal('0')
    for i, rate in enumerate(DEFAULT_ANNUAL_LAYER_RATES):
        if i + 1 in overrides:
            o_lower, o_upper, o_rate = overrides[i + 1]
            layers.append((o_lower, o_upper, o_rate))
            lower = o_upper if o_upper is not None else o_lower
            continue
        upper = Decimal(str(limits[i])) if i < len(limits) else None
        layers.append((lower, upper, rate))
        if upper is not None:
            lower = upper
    return layers


def annual_pph21(pkp, config=None):
    """Progressive Pasal 17 PPh 21 on annual taxable income (PKP).

    Uses TaxConfig.annual_brackets overrides where present, otherwise the
    statutory 5/15/25/30/35% layers with DEFAULT_ANNUAL_LAYER_LIMITS (or the
    config's annual_layer_limits). Amounts below the first threshold yield 0.
    """
    if pkp <= 0:
        return Decimal('0')
    layers = _annual_layers(config) if config is not None else [
        (Decimal('0'), DEFAULT_ANNUAL_LAYER_LIMITS[0], DEFAULT_ANNUAL_LAYER_RATES[0]),
        (DEFAULT_ANNUAL_LAYER_LIMITS[0], DEFAULT_ANNUAL_LAYER_LIMITS[1], DEFAULT_ANNUAL_LAYER_RATES[1]),
        (DEFAULT_ANNUAL_LAYER_LIMITS[1], DEFAULT_ANNUAL_LAYER_LIMITS[2], DEFAULT_ANNUAL_LAYER_RATES[2]),
        (DEFAULT_ANNUAL_LAYER_LIMITS[2], DEFAULT_ANNUAL_LAYER_LIMITS[3], DEFAULT_ANNUAL_LAYER_RATES[3]),
        (DEFAULT_ANNUAL_LAYER_LIMITS[3], None, DEFAULT_ANNUAL_LAYER_RATES[4]),
    ]
    tax = Decimal('0')
    remaining = pkp
    for lower, upper, rate in layers:
        if remaining <= 0:
            break
        width = (upper - lower) if upper is not None else remaining
        taxed = min(remaining, width)
        tax += taxed * rate / Decimal('100')
        remaining -= taxed
    return tax


def compute_december_trueup(config, ptkp_status, gross_year, pph_paid_prior,
                            months_worked=None):
    """December PPh 21 = annual true-up − Jan-Nov withholding.

    1. PKP = gross_year − biaya jabatan − PTKP (annual, Pasal 17 base).
    2. Annual PPh = progressive Pasal 17 over PKP (rounded down to 1000s).
    3. December amount = annual PPh − sum(PPh 21 Jan-Nov), floored at 0.

    Negative results mean the employee overpaid through the TER months
    (usually a mid-year PTKP change); the overpayment is refunded outside
    payroll (or claimed via the year-end SPT), so December withholds 0.

    `months_worked`: paid employment months in the year (for the biaya
    jabatan per-month cap). None/omitted = full 12 months.
    """
    if months_worked is None:
        jabatan = biaya_jabatan(gross_year)
    else:
        jabatan = biaya_jabatan_with_months(gross_year, months_worked)
    ptkp = PTKP_ANNUAL.get((ptkp_status or '').strip().upper())
    if ptkp is None:
        raise TaxConfigError(f'Status PTKP tidak dikenal: {ptkp_status!r}')
    pkp = gross_year - jabatan - ptkp
    if pkp < 0:
        pkp = Decimal('0')
    annual = round_pph(annual_pph21(pkp, config))
    december = annual - pph_paid_prior
    if december < 0:
        december = Decimal('0')
    return december, annual, pkp, jabatan


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
