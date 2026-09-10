# Payroll (`apps.payroll`)

Payroll karyawan inhouse: components, salary structures, period processing, and the
Tahap 3a calculation engine (TER PPh 21, pro-rata, unpaid-leave deduction, DTP split).
Spec source: `PRD_Modul_Payroll_Karyawan_Inhouse.md`; progress log: `payroll-note.md`.

## Architecture

| Layer | Isi |
| --- | --- |
| Models | `PayrollComponent`, `SalaryStructure`, `PayrollPeriod` (DRAFT→CALCULATED→REVIEW→APPROVED→PAID→LOCKED), `Payroll`, `PayrollItem`, `TaxConfig`, `TerBracket`, `EmployeeTaxProfile` |
| Engine | `services.py` — `calculate_period()` + helpers; all money math Decimal |
| Tax | `tax.py` — PTKP→TER mapping, active-config lookup, TER rate, monthly PPh 21 + rounding |
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
- December (interim): adds the Jan–Nov PPh 21 item sum on top of the December TER amount.
  The full annual progressive true-up (PTKP, biaya jabatan, brackets 5–35%) is Tahap 3b.

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

`refresh_payroll_totals` (manual item edits) preserves engine-owned SYSTEM deductions and
the stored `is_dtp` flag; a full `calculate_period` recompute resets everything.

## Tax configuration (data, not code)

- `TaxConfig(year, is_active, dtp_threshold, notes)` — one per tax year.
- `TerBracket(tax_config, ter_category, bruto_lower, bruto_upper|null, rate_pct)`.
- `EmployeeTaxProfile(employee 1:1, ptkp_status, tax_scheme NORMAL|GROSS_UP)` —
  `GROSS_UP` is reserved; the iterative gross-up calculation is deferred.
- `seed_tax_config` command: creates the 2026 config **inactive** with a 78-row bracket
  template whose rates are illustrative. Rates must be confirmed against PMK 168/2023 by
  the tax consultant, then `is_active=True` via admin/API. Never ship illustrative rates
  as active.

## API

| Endpoint | Method | Catatan |
| --- | --- | --- |
| `/api/payroll/components/` | CRUD | plus `is_taxable` field |
| `/api/payroll/salary-structures/` | CRUD | `history/`, `active/` actions |
| `/api/payroll/periods/` | CRUD | `calculate/review/approve/mark-paid/lock` actions |
| `/api/payroll/payrolls/` | GET | `manual_item/`, `remove_manual_item/` actions; MANAGEMENT scoped to own slips |
| `/api/payroll/tax-config/` | CRUD | ADMIN/HR only |
| `/api/payroll/tax-config/{id}/brackets/` | POST | bulk replace TER brackets (validates category/bounds/rate) |
| `/api/payroll/tax-profiles/` | CRUD | ADMIN/HR only; PTKP validated |

`Payroll` responses expose `pro_rata_factor`, `unpaid_leave_days`, `ptkp_status_snapshot`,
`ter_category_snapshot`, `is_dtp`, `transfer_amount`. Frontend client: `frontend/src/lib/payroll.ts`.

## Testing

```bash
cd backend
$env:DB_ENGINE='sqlite'
.\.venv\Scripts\python.exe manage.py test apps.payroll
```

- 58 tests: component/structure/period/calculate/manual-item suites plus
  `EngineTahap3aTests` (config guard, TER monthly, DTP both sides of the threshold,
  pro-rata join, terminated-employee final pay, `is_taxable` exclusion, PTKP snapshot,
  December carry), `TaxConfigApiTests` (RBAC + validation), `TaxHelperUnitTests`
  (category mapping, rounding).
- Test helper `make_tax_config()` builds a minimal active single-bracket table; tests
  needing PPh set `rate='1'` and `threshold='0'` to isolate TER from DTP.

## Out of scope (still)

BPJS, overtime pay (leave-compensation policy instead), attendance deduction, bank API
integration, Coretax reporting, GM aggregate/detail access (deferred — see
`payroll-tahap3-gap-analysis.md` open question A), slip PDF/terbilang/numbering (3c).
