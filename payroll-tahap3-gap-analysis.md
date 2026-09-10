# Payroll Tahap 3 — Gap Analysis vs PRD (10 Sep 2026)

Sources: `PRD_Modul_Payroll_Karyawan_Inhouse.md` (v1.0), `SESSION.md`, `payroll-note.md`, current code
(`backend/apps/payroll/*`, `frontend/src/lib/payroll.ts`, `frontend/src/features/payroll/payroll-page.tsx`,
`backend/apps/personnel/models.py`).

Payroll Tahap 1 (components + salary structures) and Tahap 2 (periods + processing) are DONE.
The PRD adds the calculation engine (PPh 21/TER, pro-rata, DTP), slip generation, and several
data-model + process requirements. This doc maps every PRD requirement to the current state and
proposes the Tahap 3 work breakdown.

---

## 1. What exists today (baseline)

- **Components**: `PayrollComponent` (category EARNING_FIXED/EARNING_VARIABLE/DEDUCTION,
  calculation_type FIXED_AMOUNT/VARIABLE/PERCENTAGE). Seed = 13 components incl. `PPh21`,
  `BPJS_KS`, `BPJS_TK`, `LOAN`, `LATE_FEE` (as deduction codes, no logic behind them yet).
- **Salary structures**: per-employee `SalaryStructure` (basic_salary + fixed components JSON,
  insert-only history, overlap-validated, effective date ranges).
- **Processing**: `PayrollPeriod` DRAFT→CALCULATED→REVIEW→APPROVED→PAID→LOCKED (forward-only);
  `calculate_period()` iterates **all** employees, builds `Payroll` + `PayrollItem` (SYSTEM items
  recreated, MANUAL items preserved); manual items (bonus/kasbon) via `manual_item` /
  `remove_manual_item`; LOCKED guard; audit logging.
- **Pull-ins**: APPROVED reimbursements in period → variable earnings; unpaid-leave days
  snapshot with amount 0 ("dihitung di engine" placeholder — that engine is Tahap 3).
- **Frontend**: 3 tabs (Payment Types / Struktur Gaji / Payroll Processing); MANAGEMENT self-slip
  page `/dashboard/management/payroll`.
- **Personnel data available**: `nik`, `npwp`, `bank_account_number/name`, `marital_status`
  (SINGLE/MARRIED/DIVORCED/WIDOWED), `join_date`, `employment_status` (ACTIVE/INACTIVE),
  contracts (PKWT/PKWTT + probation + termination_date). **No** PTKP field, no dependents count,
  no resign_date on Employee, no gross-up flag.

## 2. Requirement-by-requirement mapping

Status: ✅ done · 🟡 partial · ❌ missing

| PRD | Requirement | Status | Notes |
|---|---|---|---|
| 2.2 | Tax rates as **data**, not hardcoded (editable, per year) | ❌ | No tax config model exists at all |
| 2.3 | PTKP status **per tax year** (not overwritten), dependents | ❌ | Only `marital_status` on Personnel; no PTKP/dependents, no per-year history |
| 2.4 | TER monthly PPh 21 (Jan–Nov) | ❌ | Nothing produces PPh 21 |
| 2.4 | **December true-up** vs progressive annual; needs Jan–Nov PPh 21 queryable | ❌ | History is stored (`PayrollItem` snapshot) — query side missing with the rest |
| 2.5 | PTKP → TER Kategori A/B/C mapping | ❌ | Config table needed |
| 2.6 | No overtime pay component | ✅ | No overtime logic; design stays component-based |
| 3 | Cut-off H-5 | 🟡 | Manual process; could surface cut-off date per period (period_end − 5d) |
| 3 | Generate draft payroll for all **active** employees | 🟡 | `calculate_period` iterates `Employee.objects.all()` — includes INACTIVE; no pro-rata |
| 3 | Review → Approval (HR Lead) | ✅ | REVIEW→APPROVED transitions exist (no staff/lead separation — minor) |
| 3 | Payment recap **per bank account** for manual internet-banking upload | ❌ | No recap/export endpoint |
| 3 | Payment confirmation **+ date** | 🟡 | `mark-paid` exists; no `payment_date` field |
| 3 | Slip gaji PDF per employee | ❌ | No PDF library in `requirements.txt` |
| 3 | Distribusi slip (email/in-app) | ❌ | No notification in payroll |
| 3 | History stored as structured data | ✅ | Once PPh 21 items exist |
| 4.1 | Gaji pokok per employee | ✅ | `SalaryStructure.basic_salary` |
| 4.1 | Status kepegawaian affects entitlements | 🟡 | PKWT/PKWTT/probation exist on contract; engine may read if needed |
| 4.1 | NIK = NPWP (Coretax) | ✅ | `nik` stored; labeling only |
| 4.1 | Bank account for transfer | ✅ | On Personnel |
| 4.1 | Join date → pro-rata first month | ❌ | No pro-rata logic |
| 4.1 | Resign date → pro-rata last month | 🟡 | No `resign_date`; only contract `termination_date` / INACTIVE status — engine needs a reliable end-of-employment date |
| 4.2 | Components flexible list | ✅ | By design |
| 4.2 | **"Kena Pajak?"** flag per component | ❌ | Needed to build the taxable TER base |
| 4.3 | Per-employee-per-component amounts | ✅ | Structure JSON (fixed) + manual items (variable) |
| 4.4 | TER tariff table (category, bruto bracket, rate, **year**) | ❌ | New model + admin CRUD + seed |
| 4.5 | Periodik: periode, bonus, potongan manual, status flow | ✅ | Manual items + transitions |
| 4.6 | Per-employee results stored permanently (Bruto/PPh/Potongan/Netto) | 🟡 | Totals exist; **PPh 21 + Nominal Transfer Riil + DTP flag** missing on `Payroll` |
| 5 | Pro-rata (join/resign mid-month) | ❌ |
| 5 | PPh 21 = Bruto × TER rate | ❌ |
| 5 | December true-up (kurang/lebih bayar) | ❌ |
| 6 | Slip format per existing template; company data as **config** | ❌ | No site/company settings model |
| 6.1 | **Terbilang** (ID number-to-words) | ❌ | Small pure function + tests |
| 6.2 | DTP: THP ≤ Rp10 jt → PPh **not** really deducted (transfer = full gross); > 10 jt → deducted; slip still prints PPh | ❌ | Requires two stored values: printed THP (`net_salary`) vs `transfer_amount` |
| 6.3 | Gross-up "Tunjangan Pajak (PPh)" scheme per employee | ❌ | Decision #2 says skema Gross-Up exists → needs per-employee "Skema PPh" field; iterative calc is complex — see open questions |
| 6.3 | Slip number **resets monthly** | ❌ | e.g. `{seq:03d}/PG/{MM}/{YYYY}` |
| 6.3 | Slip footer disclaimer **editable per period** | ❌ | Field on `PayrollPeriod` (or settings) |
| 6.3 | Komisi/Bonus/THR manual input | ✅ | Manual items |
| 7 | Access: HR/Admin full; **karyawan sees own slip** | ❌ | `PAYROLL_VIEW_ROLES` = ADMIN/HR_STAFF/HR_LEAD/MANAGEMENT — **EMPLOYEE has no payroll read at all today** |
| 7 | GM visibility: aggregate **and** per-individual detail | ⚠️ | **Conflicts** with the 09 Sep decision (MANAGEMENT payroll = own slips only) — see open question A |
| 7 | Audit trail on master payroll data (before/after) | 🟡 | `log_event` on create/update exists; add `diff_changes` before/after for structures/components/tax config |
| 7 | Encryption at rest (bank no., salary) | ❌ | Plaintext today; recommend deferring with a ticket (see open question J) |
| 8 | Decisions #1–#12 | mixed | DTP 10 jt, monthly numbering, editable footer, H-5, HR Lead approval → into scope |
| 9 | Out of scope: BPJS, freelance per-event, bank API, attendance deduction, Coretax reporting | ✅ | Engine must simply not compute BPJS/attendance |

## 3. Proposed Tahap 3 work breakdown

### Backend

1. **Models + migration (`apps/payroll`)**
   - Tax config (all editable in admin, keyed by tax year):
     - `TerBracket(year, ter_category A/B/C, bruto_lower, bruto_upper, rate_pct)`
     - `PtkpRate(year, status_code TK|K × 0–3, annual_amount)`
     - `TaxSetting(year, dtp_threshold=10_000_000, biaya_jabatan_pct, biaya_jabatan_cap, progressive brackets as JSON rows 5/15/25/30/35)` — or one header model + row tables; keep it small.
   - `EmployeeTaxProfile` (1:1 Employee): `ptkp_status`, `dependents` derived into status,
     `tax_scheme` = NORMAL | GROSS_UP. Per-PRD 2.3 the status must be **per tax year** —
     either a per-year row model or snapshot-at-calc stored on each `Payroll` (recommended:
     snapshot `ptkp_status`/`ter_category` onto `Payroll` for auditability, plus editable
     current profile per employee).
   - `Payroll` new fields: `pph21`, `transfer_amount`, `is_dtp`, `unpaid_leave_days`,
     `pro_rata_factor`, `ptkp_status_snapshot`, `ter_category_snapshot`.
   - `PayrollPeriod` new fields: `payment_date` (set on mark-paid), `cutoff_date`
     (period_end − 5 days, informational), `slip_footer` (editable per period), maybe
     `slip_generated_at`.
   - `PayrollComponent.is_taxable` (BooleanField default True) + migration.
   - `PayrollSlip` (or fields on `Payroll`): `slip_number` (unique, `{seq:03d}/PG/{MM}/{YYYY}`,
     reset monthly), `generated_at`, `file`/storage path if persisted.
   - Company config: small `CompanySetting` (name, address, department signature name) —
     singleton row, admin-editable (PRD 6: not hardcoded in the template).

2. **Engine (`services.py` + new `tax.py`)**
   - `tax.py`: `ter_category(ptkp_status)`, `ter_rate(year, category, bruto)`,
     `ptkp_annual(year, status)`, `progressive_annual_tax(year, pkp)`, `terbilang(n)` (ID
     words), rounding helpers (PPh rounded down to full thousands — confirm exact rule with
     consultant).
   - `_summarize` rework:
     - Restrict to `employment_status='ACTIVE'` (+ employees whose employment ends mid-period
       via resign/termination handling).
     - Pro-rata factor from `join_date`/end-of-employment vs calendar days; apply to basic
       salary (and fixed allowances — pending open question D).
     - Taxable base = gross earnings of taxable components (exclude `is_taxable=False`, and
       decide reimbursement treatment — open question H).
     - PPh 21: months 1–11 → bruto × TER rate; **December** → sum Jan–Nov PPh 21 items for the
       year + annual progressive true-up (kurang bayar added, lebih bayar refunded into net).
     - DTP: printed `net_salary` per template; `transfer_amount` = full penghasilan when
       (net) THP ≤ 10 jt, else normal deduction.
     - Unpaid-leave deduction: `unpaid_days × daily_rate` (daily rate formula pending
       open question C).
   - `calculate_period`: December guard — require Jan–Nov periods of the same year exist and
     are CALCULATED+ (else 400 with a clear message); refuse to run when tax config for the
     year is missing/inactive (clear 400, not a silent zero-tax run).

3. **API/views**
   - Tax config CRUD viewsets (ADMIN/HR only) + audit logging with diffs.
   - `PayrollPeriod` actions: set `payment_date` on mark-paid; `recap` endpoint → Excel
     (openpyxl is already a dependency) with employee, bank, account no., `transfer_amount`.
   - Slip: `GET /api/payroll/payrolls/{id}/slip/` → PDF (xhtml2pdf or reportlab — open
     question F), generated at PAID status; slip number assigned on first generation
     (monthly reset); optional `bulk-slip` action per period.
   - Employee self access: include EMPLOYEE read scoped to own payroll rows (extend
     `get_queryset` scoping — careful to keep the recent MANAGEMENT self-only behavior intact).
   - Slip distribution: in-app notification rows (reuse the reimbursement notification
     pattern); email optional/deferred.

4. **Tests (~20–25)**
   TER monthly per category + bracket boundaries; pro-rata join/resign; unpaid-leave
   deduction; DTP both sides of 10 jt; December true-up kurang/lebih bayar + missing-month
   guard; missing tax config → 400; `transfer_amount` vs printed THP; recap content; slip PDF
   smoke + slip number monthly reset; RBAC (employee sees only own; MANAGEMENT unchanged);
   audit on tax config change; terbilang unit tests.

### Frontend

5. `lib/payroll.ts`: new types/fields + tax config CRUD, recap download, slip download,
   self-payroll functions.
6. Payroll page (HR): show PPh 21 / DTP badge / Nominal Transfer Riil columns in processing
   tab; payment-date prompt on mark-paid; per-period slip footer editor; recap + bulk slip
   buttons.
7. Tax config UI (new tab or `/dashboard/settings/tax-config`): TER brackets grid per
   year/category, PTKP table, DTP threshold, progressive brackets — with a persistent warning
   banner that rates must come from PMK 168/2023 via the tax consultant.
8. Employee tax profile editor (PTKP status + tax scheme) — HR-only, e.g. a "Perpajakan"
   card on the employee detail page.
9. Employee self-service payroll page (`/dashboard/employee/payroll`): own slips list + PDF
   download; nav-config entry for the employee group.

## 4. Open questions to settle before coding

- **A. GM visibility — RESOLVED (10 Sep 2026): DEFERRED.** Keep the current behavior
  (MANAGEMENT payroll = own slips only). GM aggregate/per-individual access is out of scope
  for Tahap 3 and will be revisited later; do not build GM-specific RBAC now.
- **B. Official TER rates:** get the PMK 168/2023 attachment from the tax consultant; until
  then seed placeholder brackets as inactive with a visible warning (never ship active
  illustrative rates).
- **C. Unpaid-leave daily rate:** basic/30 × days, basic/21, or calendar-day prorate?
  Confirm with HR/PO.
- **D. Pro-rata scope:** PRD example prorates basic salary only; do fixed allowances also
  prorate on join/resign months?
- **E. Gross-up now or later:** does any employee actually use the gross-up scheme today?
  If none, reserve the field and defer the iterative gross-up calculation.
- **F. PDF library:** xhtml2pdf (HTML/CSS — easiest to match the existing template) vs
  reportlab (lower-level, no CSS). Recommendation: xhtml2pdf.
- **G. Slip distribution:** in-app only for v1? (Email infra absent today.)
- **H. Reimbursement taxability:** currently added into gross earnings — taxable for TER or
  excluded (`is_taxable=False`)?
- **I. Rounding:** exact PPh rounding rule (down to full thousands?) — confirm with consultant.
- **J. Encryption at rest:** defer with a tracked ticket, or implement field-level
  encryption for `bank_account_number` now?

## 5. Suggested phasing

- **3a (core engine):** tax config models + seed (inactive placeholders), PPh 21 monthly,
  pro-rata, DTP two-value fields, ACTIVE-only + missing-config guards, tests.
- **3b (December + reconciliation):** true-up, year aggregation, December guard, tests.
- **3c (slip):** terbilang, PDF generation, numbering, company/footer config, employee
  self-service page + RBAC, recap export, notifications.
