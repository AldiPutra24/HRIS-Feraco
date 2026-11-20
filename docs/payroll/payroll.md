# Payroll (`apps.payroll`)

Payroll karyawan inhouse: components, salary structures, period processing, the
Tahap 3a calculation engine (TER PPh 21, pro-rata, unpaid-leave deduction, DTP
split), and the Tahap 3b December annual true-up (Pasal 17 progressive + biaya
jabatan + PTKP).
Spec source: `PRD_Modul_Payroll_Karyawan_Inhouse.md`.

## Architecture

| Layer | Isi |
| --- | --- |
| Models | `PayrollComponent`, `SalaryStructure`, `PayrollPeriod` (DRAFT→CALCULATED→REVIEW→APPROVED→PAID→LOCKED), `Payroll`, `PayrollItem`, `TaxConfig`, `TerBracket`, `AnnualTaxBracket`, `EmployeeTaxProfile` |
| Engine | `services.py` — `calculate_period()` + helpers; all money math Decimal |
| Tax | `tax.py` — PTKP→TER mapping, active-config lookup, TER rate, monthly PPh 21 + rounding; December true-up (biaya jabatan, PTKP tahunan, Pasal 17 layers) |
| API | DRF router at `/api/payroll/`: `components`, `salary-structures`, `periods`, `payrolls`, `tax-config`, `tax-profiles` |
| RBAC | `PAYROLL_ADMIN_ROLES` = ADMIN/HR_STAFF/HR_LEAD (write), read adds MANAGEMENT. Tax config/profiles = admin roles only |

Snapshot rule: `PayrollItem` freezes component name/code/category at calculation time;
`Payroll` freezes `ptkp_status_snapshot` / `ter_category_snapshot`. Editing masters never
rewrites history (PRD 2.3 / 4.6).

## Calculation flow (`calculate_period`)

Guards → per-employee window → earnings → deductions → PPh 21 → DTP split.

1. **Status guard** — only `DRAFT` periods can be calculated.
2. **Config guard** — requires an active `TaxConfig` for `period_year`; otherwise
   `ValidationError` (API 400). PPh 21 is never silently skipped.
3. **Who gets paid** — employees `ACTIVE` plus employees with a TERMINATED contract whose
   `termination_date >= period_start` (final pay). Plain INACTIVE without termination date
   is skipped.
4. **Employment window** — `join_date > period_start` clamps the start;
   `termination_date` clamps the end. Window start > end → no payroll row.
5. **Earnings** — basic salary, fixed components from the effective `SalaryStructure`,
   MANUAL items (preserved across recalcs), APPROVED reimbursements in the period.
6. **Deductions** — MANUAL deduction items + unpaid-leave amount + PPh 21 (all SYSTEM).
7. **Totals** — `gross = basic + fixed + variable + reimbursement`;
   `net = gross − total_deduction`.

MANUAL items survive recalculation; only SYSTEM items are deleted/recreated.

## TER / PPh 21 (monthly, Jan–Nov)

- PTKP status (`TK/0`..`K/3`) → TER category via fixed mapping (PRD 2.5):
  A = TK/0, TK/1, K/0 · B = TK/2, TK/3, K/1, K/2 · C = K/3.
- Taxable base = basic + fixed + variable earnings from components with `is_taxable=True`
  (reimbursements are excluded — code prefix `REIMBURSEMENT_`).
- Monthly PPh 21 = taxable base × TER `rate_pct` of the matching `TerBracket`
  (`bruto_lower ≤ base`, `bruto_upper` NULL = open top), rounded **down** to the nearest
  thousand rupiah (`round_pph`).
- Result stored as a SYSTEM `PayrollItem` with `component_code='PPh21'` plus
  `ptkp_status_snapshot` / `ter_category_snapshot` on `Payroll`.

## December annual true-up (Tahap 3b)

PMK 168/2023: for TER-category employees, the **masa pajak terakhir** (December, or the
final paid month of a mid-year termination) recalculates PPh 21 on the full tax year:

```
PPh setahun   = (penghasilan bruto setahun − biaya jabatan − PTKP tahunan) × Pasal 17 (5–35%)
PPh Desember  = PPh setahun − Σ PPh 21 yang sudah dipotong bulan-bulan sebelumnya
```

- **Annual gross** — rebuilt from persisted payroll data: per calculated period of the
  year, `Payroll.basic_salary` (stored on the row, not as an item) + every SYSTEM taxable
  earning item, plus the current (December) month's taxable earnings. Reimbursements stay
  excluded (`is_taxable=False`). Months must be calculated in order; uncalculated months
  are simply missing from the base (recap behavior — see below).
- **Biaya jabatan** — 5% of annual gross, max Rp500.000 per month actually worked
  (`months_worked` sums each period's `pro_rata_factor`, so join/termination prorations
  count fractionally), annual cap Rp6.000.000.
- **PTKP tahunan** — statutory table since 2016 (TK/0 54jt … K/3 72jt), PRD 2.3.
- **Pasal 17 layers** — statutory defaults 60jt/250jt/500jt/5M at 5/15/25/30/35%, used at
  cost index 0 (no indexing). Overridable per tax year via `TaxConfig.annual_layer_limits`
  or `AnnualTaxBracket` rows (layer_order 1–5); absent layers fall back to the defaults.
- **Result** — December item amount rounded per `round_pph` on the annual figure; negative
  true-up (employee overpaid via TER months, e.g. after a mid-year PTKP change) is floored
  at 0 — the refund belongs to the year-end SPT, not payroll.
- **Snapshots** — `Payroll.pph_prior_months` (Σ Jan–Nov withholding) and `Payroll.pph_annual`
  (the computed annual PPh) are stored per December payroll for audit/recap.
- **Mid-year termination** — `window.end < period_end` marks the period as the employee's
  final masa pajak; the true-up runs there instead of December (PMK "masa pajak terakhir").
  December no longer carries a prior-month PPh sum on top of TER (old interim behavior —
  replaced).

## Pro-rata

Factor = paid calendar days ÷ days in month, capped at 1; applied to **basic salary only**
(PO decision, PRD Section 5 example). Fixed allowances are not prorated. Join on the 10th
of a 30-day month → factor 21/30. Full-month windows stay exactly 1.

## Unpaid leave

Approved `LeaveRequest` with `leave_type.is_paid=False` overlapping the period → days
counted per calendar overlap. Deduction = (basic salary + fixed allowances) ÷ 30 × days
(PO decision), rounded to whole rupiah, emitted as a SYSTEM `UNPAID_LEAVE` item and added
to `total_deduction`. `unpaid_leave_days` is stored on `Payroll`.

## DTP (Ditanggung Pemerintah) — two stored values

Per PRD 6.2 the slip prints normal THP, but the transferred amount can differ:

- `net_salary` — printed Take Home Pay (always the "normal" figure).
- `transfer_amount` — what Finance actually transfers:
  - THP ≤ `TaxConfig.dtp_threshold` (default Rp10 jt) → `is_dtp=True`,
    `transfer_amount = net_salary + pph21` (employee receives full gross minus other
    deductions; the government bears the PPh).
  - THP above the threshold → `is_dtp=False`, `transfer_amount = net_salary`.

The DTP split applies to the true-up month as well (December item amount is the PPh
compared against the threshold). `refresh_payroll_totals` (manual item edits) preserves
engine-owned SYSTEM deductions and the stored `is_dtp` flag; a full `calculate_period`
recompute resets everything.

## Tax configuration (data, not code)

- `TaxConfig(year, is_active, dtp_threshold, annual_layer_limits, notes)` — one per tax
  year. `annual_layer_limits` = JSON list of 4 ascending layer bounds (empty = statutory
  60jt/250jt/500jt/5M); validated in the serializer and model `clean()`.
- `TerBracket(tax_config, ter_category, bruto_lower, bruto_upper|null, rate_pct)`.
- `AnnualTaxBracket(tax_config, layer_order 1–5, pkp_lower, pkp_upper|null, rate_pct)` —
  optional per-layer overrides of the statutory Pasal 17 table (unique per config+layer).
- `EmployeeTaxProfile(employee 1:1, ptkp_status, tax_scheme NORMAL|GROSS_UP)` —
  `GROSS_UP` is reserved; the iterative gross-up calculation is still deferred.
- `seed_tax_config` command: creates the 2026 config **inactive** with a 78-row bracket
  template whose rates are illustrative. TER rates must be confirmed against PMK 168/2023
  by the tax consultant, then `is_active=True` via admin/API. Never ship illustrative rates
  as active. The annual Pasal 17 layers are statutory — no rows are seeded.

## API

| Endpoint | Method | Catatan |
| --- | --- | --- |
| `/api/payroll/components/` | CRUD | plus `is_taxable` field |
| `/api/payroll/salary-structures/` | CRUD | `history/`, `active/` actions |
| `/api/payroll/periods/` | CRUD | `calculate/review/approve/mark-paid/lock` actions |
| `/api/payroll/periods/{id}/recap/` | GET | rekap transfer XLSX (HR only) |
| `/api/payroll/payrolls/` | GET | `manual_item/`, `remove_manual_item/` actions; MANAGEMENT scoped to own slips |
| `/api/payroll/payrolls/{id}/payslip/` | GET | slip gaji PDF (HR only; period PAID/LOCKED) |
| `/api/payroll/tax-config/` | CRUD | ADMIN/HR only; exposes `annual_layer_limits` + nested `annual_brackets` |
| `/api/payroll/tax-config/{id}/brackets/` | POST | bulk replace TER brackets (validates category/bounds/rate) |
| `/api/payroll/tax-config/{id}/annual_brackets/` | POST | bulk replace annual Pasal 17 layer overrides; empty list resets to defaults |
| `/api/payroll/tax-profiles/` | CRUD | ADMIN/HR only; PTKP validated |

`Payroll` responses expose `pro_rata_factor`, `unpaid_leave_days`, `ptkp_status_snapshot`,
`ter_category_snapshot`, `pph_prior_months`, `pph_annual`, `is_dtp`, `transfer_amount`.
Frontend client: `frontend/src/lib/payroll.ts`.

## Tax Config UI (frontend)

Pure-frontend feature over the existing Tahap 3a/3b APIs — no new endpoints. Lives in the
4th tab **Konfigurasi Pajak** of `frontend/src/features/payroll/payroll-page.tsx`
(`TaxConfigSection`). `TaxConfigSerializer` now also exposes `ter_brackets` (read-only
nested) so the TER editor can load existing rows.

- **Config general** — year `<select>` + active `Badge`; empty state card hints
  `seed_tax_config`. `TaxConfigDetail` edits `dtp_threshold` (`updateTaxConfig`) and toggles
  `is_active` via a `Switch`.
- **Annual layer limits** — 4 number inputs; empty → `null` (resets to statutory
  60jt/250jt/500jt/5M). Saved through `updateTaxConfig({annual_layer_limits})`.
- **TER brackets** (`TerBracketsCard`) — rows `{ter_category A/B/C, bruto_lower, bruto_upper
  (''=∞), rate_pct}`; bulk-saved via `replaceTaxBrackets` (upper `''`→null). Button
  "Simpan Semua (ganti total)".
- **Annual Pasal 17 override** (`AnnualBracketsCard`) — rows `{layer_order 1–5, pkp_lower,
  pkp_upper, rate_pct}`, capped at 5 layers; empty state shows the statutory 5/15/25/30/35%
  fallback. Saved via `replaceAnnualBrackets`; "Reset ke Statutory" when empty.
- **Employee tax profiles** (`TaxProfilesCard`) — loads `listTaxProfiles()` +
  `listEmployees({page_size:'1000'})`; per active employee a PTKP `<select>` (empty =
  TK/0 default) + TER category display + scheme `<select>` (NORMAL/GROSS_UP). Saved via
  `upsertTaxProfile`. Header shows "Tanpa profil: N karyawan (default TK/0, NORMAL)" and a
  missing-profile filter + search.

## Testing

```bash
cd backend
$env:DB_ENGINE='sqlite'
.\.venv\Scripts\python.exe manage.py test apps.payroll
```

- 78 tests: component/structure/period/calculate/manual-item suites,
  `EngineTahap3aTests` (config guard, TER monthly, DTP both sides of the threshold,
  pro-rata join, terminated-employee final pay, `is_taxable` exclusion, PTKP snapshot),
  `EngineTahap3bTests` (Pasal 17 layers + boundaries, biaya jabatan caps, true-up math
  with/without prior withholding, overpayment floored at 0, full-engine December runs,
  salary-raise scenario with extra December withholding, mid-year termination true-up in
  the final month, annual layer override), `TaxConfigApiTests` (RBAC + validation +
  `annual_brackets/` bulk replace), `TaxHelperUnitTests` (category mapping, rounding),
  `Tahap3cTests` (terbilang, monthly-resetting slip numbers, payslip PDF guard + RBAC +
  content, recap XLSX content + RBAC).
- Test helper `make_tax_config()` builds a minimal active single-bracket table; tests
  needing PPh set `rate='1'` and `threshold='0'` to isolate TER from DTP.

## Out of scope (still)

BPJS, overtime pay (leave-compensation policy instead), attendance deduction, bank API
integration, Coretax reporting, GM aggregate/detail access (deferred — see
`payroll-tahap3-gap-analysis.md` open question A), employee self-service slips,
GROSS_UP iterative scheme, refund of TER overpayment inside payroll (handled via the
annual SPT).
