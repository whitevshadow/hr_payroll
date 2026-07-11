# Codebase Audit — Findings & Resolutions

Audit of the HR & Payroll platform (11 FastAPI microservices + gateway + React
frontend + `hr_shared`). Every finding below was confirmed by reading the code,
and every fix ships with a passing test unless noted.

**Scope note:** the system is operated by **admins only** — there are no real
EMPLOYEE / HR_MANAGER / PAYROLL_ADMIN sub-roles in use. Findings that were purely
about *role separation* are therefore recorded as **N/A** rather than "fixed":
adding role guards would add friction with no security benefit when every user is
an admin. Tenant/client isolation, payroll correctness, and PII auditing all still
apply and were fixed.

Branch: `fix/codebase-audit`.

---

## Critical

| ID | Issue | Status |
|----|-------|--------|
| **C1** | **Hardcoded fallback JWT signing secret.** Every service fell back to a publicly-known key when `JWT_SECRET` was unset — anyone could forge a `SUPER_ADMIN` token for any tenant. | ✅ Fixed — secret is now required (no default) with a validator rejecting known-weak values; compose fails fast; `.env.example` placeholders. |
| **C2** | **Login ignored tenant.** Users were resolved by email alone via `.first()`, so a duplicate email across tenants authenticated against an arbitrary tenant. | ✅ Fixed — login binds to `(tenant_id, email)`; an ambiguous email is rejected instead of guessed. Makes the repo's own red `test_login_isolation.py` pass (5/5). |
| **C3** | **`x-client-id` trusted from the request header.** Never checked against the caller's tenant — a user could reference another tenant's client company. | ✅ Fixed — the gateway validates client ownership (fails closed) before forwarding, with a TTL cache. |
| **C10** | **2025 Act §87A rebate hardcoded to ₹0.** This law applies to the live payroll path, so everyone earning ≤ ₹12L taxable was over-deducted full slab tax instead of nil. | ✅ Fixed — rebate set to threshold ₹12,00,000 / amount ₹60,000. |
| C4–C9 | Missing **role** guards on salary structures, TDS compute/overview, payslips, proof approval, compliance settings, and the cosmetic frontend route guard. | ⚪ **N/A — admin-only system** (see scope note). |

## High

| ID | Issue | Status |
|----|-------|--------|
| **H1** | **Attendance writes dropped `client_id`** while every read filters on it → reads 404'd and payroll's fallback treated everyone as full-attendance, **paying unpaid-leave employees in full**. | ✅ Fixed — `client_id` persisted on both write paths. |
| **H3** | **Bulk employee import dropped `client_id`** → imported employees invisible to client-scoped listings and payroll. | ✅ Fixed. |
| **H5** | **Auth token read from the wrong storage key** (`"token"` vs `"hrp_token"`) → SSE never authenticated (real-time updates dead); document downloads sent `Bearer null`. | ✅ Fixed — both use the `getToken()` accessor. |
| **H6** | **Switching client company didn't invalidate the query cache** → the dashboard kept showing the previous client's data. | ✅ Fixed — cache reset on client change. |
| **H7** | **PII masking was display-only.** `GET /employees/{id}` (and the list) returned full PAN/Aadhaar/bank/UAN — readable from the network tab with no audit trail. | ✅ Fixed — server masks PII by default; the `pii-access` endpoint is the only way to obtain raw values and records an audit event. |
| **H8** | Attendance grid save omitted `lop_days` (inconsistent with the import path). | ✅ Fixed (consistency — the backend recomputes LOP, so this was not an active pay bug). |
| **H9** | **Employer EPF/EPS split wrong when the PF ceiling is disabled** — EPS stayed capped while the residual rate applied to the full wage, so EPF+EPS ≠ 12% (basic ₹30,000 → EPF ₹1,101 instead of ₹2,350.50), understating statutory liability. | ✅ Fixed — EPF = total − EPS. |
| **H10** | **Compliance fallback yielded zero deductions.** With no `ComplianceSetting` row, a transient object's `*_enabled` flags were `None` (defaults only apply on flush) → **PF/ESI/PT silently skipped for everyone**. | ✅ Fixed — fallback carries the statutory defaults. |
| **H13** | Postgres (`hr/hr`), blobstore, and the MinIO console were published to the host, bypassing the gateway auth chokepoint. | ✅ Fixed — only gateway, frontend, and MinIO's S3 port (needed for browser presigned URLs) remain published. |
| H2 | *"WFH counted as loss-of-pay."* | ❌ **False positive — not a bug.** The attendance grid counts a WFH day as *present*, so `present_days` already includes WFH. Subtracting `wfh` again double-counts it and **hides genuine LOP** (a fix here was implemented, found to be a regression, and reverted). Regression tests now pin the real convention. |
| H4, H11, H12 | Admin-tier escalation; workflow approver role; blob ownership role-check. | ⚪ **N/A — admin-only system.** |

## Medium

| ID | Issue | Status |
|----|-------|--------|
| **M1** | **Salary → TDS auto-compute never worked** — it sent no bearer (401) *and* referenced a non-existent `settings.tds_url` (AttributeError), both swallowed by a broad `except`. TDS was never auto-populated. | ✅ Fixed — mints a service token, forwards client scope, adds the missing setting. |
| **M2** | **Surcharge never computed** — high earners (> ₹50L) under-deducted 10–37%. | ✅ Fixed — slab-based surcharge (new regime capped at 25%). Marginal relief is *not* modelled (flagged `VERIFY`). |
| **M3** | **TDS overview auto-approved every declared proof** → the old-regime projection deducted unverified investments and understated tax. | ✅ Fixed — only proofs with `status=APPROVED` grant a deduction. |
| **M4** | **`run_cycle` had no concurrency guard** — two concurrent runs could both pass the DRAFT→LOCKED check and process the cycle twice. | ✅ Fixed — row lock (`FOR UPDATE`) makes the check+transition atomic; the loser gets 409. |
| **M6** | TDS "no client selected" guard sat **inside a `useEffect`** — it never rendered, leaked the mousedown listener, and had a stale-closure dep. | ✅ Fixed. |
| **M8** | Compliance **CSV export leaked every client's rows** and the KPI totals ignored the client filter (disagreeing with the tables). | ✅ Fixed — one client-filtered row set drives tables, KPIs, and export. |
| **M9** | Dashboard/Reports **FY & period selectors were no-ops** (header text only). Also, FY dropdown labels were blank (`year_label` vs the backend's `name`). | ✅ Fixed — selectors now drive the reported cycle / report list. |
| **M11** | Gateway **didn't strip inbound identity headers**; on public paths a client-supplied `x-tenant-id`/`x-user-id` passed straight through. | ✅ Fixed — always stripped, then re-added from the verified JWT. |
| **M12** | **Frontend API base baked to `localhost:8000`** at image build → the image only worked on the same host as the gateway. | ✅ Fixed — same-origin `/api/v1` + nginx proxy; nothing host-specific in the bundle. |
| **M14** | AuditLog re-fetched **500 rows on every keystroke** (the query key included filters the server ignores). | ✅ Fixed — key matches the query inputs; filtering stays client-side. |
| **M15** | Payouts "Total Disbursed" summed FAILED transactions; Retry disabled *every* row. | ✅ Fixed. |
| M5, M10, M13 | Startup secret validation; leave-request self-check; single-employee client scoping. | ⚪ Folded into C1 / N/A (admin-only) / covered by C3. |

## Low

All fixed:

- **`mask_bank_account("1234")` returned `"XXXX"`** — a 4-digit account has nothing to mask (the last 4 *are* the value). *(Found during this audit; not in the original list.)*
- Dead, misleading `_admin` guard in TDS routes (never applied, and listed `EMPLOYEE` beside the admin roles) — removed rather than left implying protection.
- `activate_financial_year` didn't deactivate the others → multiple "active" FYs.
- `hasRole` was case/whitespace sensitive → backend role drift would silently hide nav and approve buttons with no error.
- `formatDate`/`formatMonth`/`formatDateTime` rendered the literal string `"Invalid Date"`.
- `AppShell` read the **global `window.location`** for its page-transition key.
- `CycleDetail` called `.length` on a possibly-absent `errors` array.
- Duplicate `#f-client` DOM id — two selects bound to `client_id` behaving differently on edit.
- Payout **idempotency key ignored `tenant_id`** (money-movement path) and the dedup lookup wasn't tenant-scoped.
- Password minimum raised 6 → 8.
- MinIO CORS wildcard `"*"` pinned to the frontend origin.

---

## Verification

Backend fixes all ship with tests. Full suite:

| Service | Result |
|---------|--------|
| auth | 5 passed |
| attendance | 21 passed |
| employee | 18 passed |
| compliance | 8 passed |
| tds | 10 passed |
| payroll | 2 passed |
| gateway | 6 passed |
| salary | 1 passed |

Two pre-existing failures remain in `employee/test_pii_encryption.py`
(`test_ciphertext_stored_not_plaintext`, `test_same_plaintext_produces_different_ciphertext`).
They are a **test-harness artifact**, not a product bug: both use raw SQL
`WHERE id = :id` with a dashed UUID string, which doesn't match SQLite's
dash-less storage. They fail identically on the pre-audit code.

Frontend changes were verified via the TypeScript language server and code
inspection — this environment has no Node runtime, so `tsc`/`vite build` could
not be executed. **Recommended before merge:** run `npm run typecheck && npm run build`,
then `docker compose up --build` and walk the README's definition-of-done flow.

## Known gaps / follow-ups

- **Tax marginal relief is not modelled** — neither for the surcharge thresholds
  nor the §87A rebate cliff at ₹12L. The slab *rates* match current Indian law, but
  income just above a threshold is slightly over-deducted. Worth implementing for
  real use.
- **Crash recovery for payroll cycles**: a cycle stranded in `COMPUTING` (if a run
  crashes mid-way) cannot be re-run, since `COMPUTING` is not in `RUNNABLE`. Needs a
  heartbeat/timeout design to distinguish "running" from "stranded".
- Statutory constants remain flagged `# VERIFY against current government notification`.
