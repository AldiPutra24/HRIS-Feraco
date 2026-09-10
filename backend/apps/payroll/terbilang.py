"""Indonesian number-to-words (terbilang) for payslip printing (PRD 6.1).

Stdlib-only; whole rupiah amounts (payroll totals are rounded to rupiah).
"""

SATUAN = [
    '', 'satu', 'dua', 'tiga', 'empat', 'lima', 'enam', 'tujuh', 'delapan',
    'sembilan', 'sepuluh', 'sebelas',
]


def _words(n: int) -> str:
    if n < 12:
        return SATUAN[n]
    if n < 20:
        return _words(n - 10) + ' belas'
    if n < 100:
        return _words(n // 10) + ' puluh' + (' ' + _words(n % 10) if n % 10 else '')
    if n < 200:
        return 'seratus' + (' ' + _words(n - 100) if n > 100 else '')
    if n < 1000:
        return _words(n // 100) + ' ratus' + (' ' + _words(n % 100) if n % 100 else '')
    if n < 2000:
        return 'seribu' + (' ' + _words(n - 1000) if n > 1000 else '')
    for divisor, label in ((1_000_000_000, 'miliar'), (1_000_000, 'juta'), (1_000, 'ribu')):
        if n >= divisor:
            head, rest = divmod(n, divisor)
            return _words(head) + ' ' + label + (' ' + _words(rest) if rest else '')
    raise ValueError('Angka terlalu besar (maks 999 miliar).')


def terbilang(amount) -> str:
    """e.g. 9_039_000 -> 'Sembilan Juta Tiga Puluh Sembilan Ribu Rupiah'."""
    n = int(amount)
    if n < 0:
        raise ValueError('Terbilang tidak mendukung angka negatif.')
    if n == 0:
        return 'Nol Rupiah'
    return (_words(n) + ' rupiah').title()
