# HR & Payroll SaaS — Version 1.1

A working, multi-tenant HR & Payroll platform: 8 FastAPI microservices + an
API gateway + a React frontend, all behind a single PostgreSQL instance
(schema-per-service). V1 is a deliberately simplified-but-fully-working slice:
synchronous HTTP orchestration, no message broker, simulated payouts.

**V1.1 adds:** an informative 8-widget dashboard (KPIs, payroll trend chart,
headcount donut, statutory compliance, activity feed, action items, statutory
deadlines), role-aware navigation (`SUPER_ADMIN`/`ORG_ADMIN`/`PAYROLL_ADMIN` /
`HR_MANAGER` / `EMPLOYEE`), in-app notifications, and full pages for
Departments, Employee detail (with masked PII + audited reveal), Compliance
(PF/ESI/PT + CSV export), TDS (slab trace + investment declarations), Payouts
(reconciliation + retry), Reports & statutory calendar, an upgraded Audit log
(filters + PII-access tab + payload drawer), and employee self-service (`/me`).

**Definition of done:** an HR admin logs in, creates an employee, assigns a
salary structure, enters attendance, runs a payroll cycle, approves it, and
views a payslip with correct PF / ESI / PT / TDS / LOP deductions and net pay —
all persisted in PostgreSQL and visible in the UI.

> ⚠️ Statutory rates/slabs (PF, ESI, PT, TDS, standard deduction) are reasonable
> V1 defaults, **not legal advice**. Every constant is in a config module marked
> `# VERIFY against current government notification`. Verify before any real use.

---

## Prerequisites

- Docker + Docker Compose
- Python 3.9+ on the host (only to run `scripts/seed.py`, which is stdlib-only)

## Run it

```bash
docker compose up --build
```

This starts PostgreSQL (with all schemas created), all 9 backend services, the
gateway (`http://localhost:4000`), and the frontend (`http://localhost:4050`).
Each service creates its own tables on startup (V1 uses SQLAlchemy
`create_all`; see the Alembic note under V2 roadmap).

### How the browser reaches the backend

**Everything the app needs is served from the frontend's own origin
(`http://localhost:4050`).** The bundle calls a relative `/api/v1/...`, and nginx
proxies `/api/` to the gateway on the compose network:

```
browser ──▶ localhost:4050  ──nginx /api/──▶  gateway:4000 ──▶ services
   (SPA + API + SSE + file upload/download, all one origin — no CORS)
```

Consequences worth knowing:

- **Nothing is hard-coded to `localhost`** in the built image, so it works on any
  host. (Override with `VITE_API_BASE` only if you want an absolute API URL.)
- **Blob uploads/downloads stream through the gateway** (`/api/v1/blobs/{id}`).
  The browser never talks to MinIO, so the object store publishes **no host
  port** — there are no presigned URLs pointing at it.
- Only **three ports** are published: frontend `4050`, gateway `4000`, and
  Postgres/MinIO/blobstore are internal-only. The gateway port stays open because
  `scripts/seed.py`, the e2e test, and curl/Postman talk to it directly — the
  browser does not need it.

Then seed demo data (in another terminal):

```bash
python scripts/seed.py
```

Open **http://localhost:4050** and log in.

### Demo credentials

The seed creates three users so you can exercise role-based access:

| Role | Login | Access |
| --- | --- | --- |
| Admin (ORG_ADMIN + HR_MANAGER + PAYROLL_ADMIN) | `admin@demo.com` / `Admin@123` | Full access |
| HR Manager | `hr@demo.com` / `Hr@12345` | No Approve & Disburse, no Audit log |
| Employee (self-service, linked to E001) | `e001@demo.com` / `Emp@12345` | Only `/me` — own payslips & attendance |

---

## End-to-end click-path (acceptance flow)

1. **Log in** with the demo admin → dashboard loads.
2. **Employees** → "+ New Employee" → create one (e.g. location *Pune*); save.
3. **Salary** → pick that employee → type a CTC → watch the live Basic/HRA/
   Special preview → "Save Structure".
4. **Attendance** → pick the current month → set present/total days for everyone
   (LOP + payable days are derived live) → Save each row.
5. **Payroll Cycles** → "+ New Cycle" (defaults to the current month) → open it.
6. On the cycle page, **Run** → status moves to `COMPUTED`.
7. **Review Summary** → per-employee gross / PF / ESI / PT / TDS / LOP / net,
   with a totals row. Verify a row by hand (see formulas below).
8. **Approve & Disburse** → status `DISBURSED`; payout transactions marked
   `SUCCESS` with `TRRN-…` references; payslips generated.
9. Click **Payslip** on any row → rendered HTML payslip → **Download PDF**.
10. **Audit Log** → shows `PAYROLL_RESULT_COMPUTED`, `PAYOUT_BATCH_CREATED`,
    `PAYSLIPS_GENERATED`, `PAYROLL_CYCLE_DISBURSED` events.

Re-running **Run** on the same cycle does **not** duplicate result rows
(idempotent upsert on `(tenant_id, cycle_id, employee_id)`).

---

## Business formulas (V1)

| Item | Rule |
| --- | --- |
| Monthly gross | `ctc / 12` |
| Basic | `40% × gross` |
| HRA | `50% × basic` (metro) / `40% × basic` (non-metro). Metro = Mumbai, Delhi, Kolkata, Chennai |
| Special allowance | `gross − basic − hra` (absorbs rounding) |
| LOP deduction | `(gross / total_days) × lop_days` |
| Employee PF | `12% × min(basic, 15000)` (ceiling toggle, default ON) |
| ESI | `0.75%` employee / `3.25%` employer, only if `gross ≤ 21000` |
| PT | Maharashtra `200`/month, `300` in February (config-driven slab) |
| TDS | New-regime slabs on `annual_gross − 75000`, `+4%` cess, `÷12` |

All money is `Decimal`, `NUMERIC(12,2)`, `ROUND_HALF_UP`, rounded once per
persisted value.

---

## Project layout

```
.
├── services/               # one directory per microservice
│   └── <name>-service/
│       ├── app/            # main.py, routes.py, models.py, schemas.py,
│       │                   # deps.py, settings.py  (+ logic.py where there
│       │                   # is real domain maths)
│       ├── tests/
│       └── .env.example
├── shared/hr_shared/       # cross-service library: auth, db, crypto,
│                           # money, audit, config, service runtime
├── frontend/               # React + TypeScript SPA (Vite, nginx in prod)
├── scripts/                # operational scripts only (see below)
├── tests/                  # cross-service end-to-end tests
├── docs/                   # all documentation — start at docs/README.md
├── docker-compose.yml      # the whole stack
├── Dockerfile.service      # one image recipe, parameterised per service
├── conftest.py             # shared pytest defaults
└── pytest.ini
```

Every service follows the same internal shape, so once you can read one you can
read them all. `scripts/` holds only what the stack or a human actually runs:
`init-db.sql` / `init-minio.sh` (compose), `setup_env.py` (generate `.env`),
`seed.py` (demo data), `generate_graph.py`, and the `trigger_*` dev helpers.

**Documentation lives in [`docs/`](docs/README.md)** — including the codebase
audit ([docs/ISSUES.md](docs/ISSUES.md)) and the manual test walkthrough.

## Architecture

| Service | Port | Schema |
| --- | --- | --- |
| gateway | 4000 | — |
| auth-service | 4001 | auth_schema |
| employee-service | 4002 | employee_schema |
| salary-service | 4003 | salary_schema |
| attendance-service | 4004 | attendance_schema |
| payroll-service | 4005 | payroll_schema (+ audit_schema, notification_schema) |
| tds-service | 4006 | tds_schema |
| compliance-service | 4007 | compliance_schema |
| payout-service | 4008 | payout_schema |
| reporting-service | 4009 | reporting_schema |

- **Gateway** validates the JWT, injects `x-tenant-id`, and reverse-proxies to
  the right service. Only the gateway (4000) and frontend (4050) are exposed to
  the host; services talk to each other by container name.
- **payroll-service** is the orchestrator: on `run` it calls salary →
  attendance → compliance → tds over HTTP (`httpx`), sequentially per employee,
  and upserts a `payroll_results` row. On `approve` it calls payout (simulated)
  then reporting (payslips), and writes audit rows.
- **shared/** is an installable package (`hr_shared`) with the
  `TenantAwareBase`, async engine/session builders, JWT context dependency,
  `Money` helper, audit log helper, and settings base.

### State machine

`DRAFT → LOCKED → COMPUTING → COMPUTED → APPROVED → DISBURSED`
(one-directional; `DISBURSED` is terminal; invalid transitions → HTTP 409).

### Role model (V1.1)

Roles come from `GET /auth/me` and are enforced **server-side** (the shared
`runtime.require_roles(...)` dependency); the UI hides/disables actions as UX.

| Role | Can approve & disburse | Can read audit | Can manage employees | Self-service |
| --- | :---: | :---: | :---: | :---: |
| SUPER_ADMIN / ORG_ADMIN / PAYROLL_ADMIN | ✅ | ✅ | ✅ | ✅ |
| HR_MANAGER | ❌ | ❌ | ✅ | ✅ |
| EMPLOYEE | ❌ | ❌ | ❌ (own record only) | ✅ (`/me`) |

---

## V1.1 acceptance checklist (all verified end-to-end)

1. ✅ Dashboard renders 8 widgets, each skeletoning independently.
2. ✅ Payroll trend chart shows last cycles chronologically with INR tooltips.
3. ✅ KPIs (net payout, statutory liability, LOP, open issues) compute from real data.
4. ✅ Role gating: `HR_MANAGER` → approve `403`, audit `403`; `admin` → audit `200`.
5. ✅ Reveal PAN on Employee detail → `PII_ACCESSED` audit event recorded.
6. ✅ Compliance PF/ESI/PT tabs reconcile (PF sum == Σ `breakdown.deductions.employee_pf`).
7. ✅ TDS slab trace renders; submitting a declaration creates a `tds_declarations` row.
8. ✅ Payout retry on a SUCCESS txn → `409`; FAILED → flips to SUCCESS + new `TRRN-`.
9. ✅ Form 16 / PF ECR buttons create `generated_reports` rows with "Coming in V2" status.
10. ✅ Approve a cycle → notification appears for admins within ~30s; mark-as-read works.
11. ✅ Statutory calendar lists next 3 deadlines with red/amber day countdowns.
12. ✅ `EMPLOYEE` sees `/me` only; `/employees` & other employees' data → `403`;
    `GET /payroll/results/me/{cycle}` returns only their own row.

---

## 🕸️ Knowledge Graph (Graphify)

This project features a fully compiled, persistent knowledge graph of its microservice architecture, relationships, and cross-cutting dependencies, built using `graphify`.

### How to use Graphify

To run a full semantic and AST analysis on the codebase and generate the interactive visualization and report:

```bash
# 1. Install graphifyy and initialize integration
py -m pip install graphifyy
py -m graphify antigravity install

# 2. Run the extraction and generation pipeline
py scripts/generate_graph.py
```

This creates a dedicated folder `graphify-out/` containing:
- **`graphify-out/graph.html`**: An interactive D3 force-directed visualizer. Open it in any browser to explore files, symbols, and dependencies grouped into communities.
- **`graphify-out/GRAPH_REPORT.md`**: A comprehensive plain-language audit report highlighting God Nodes (most connected core abstractions), Surprising/Inferred Connections, Hyperedges, and suggested architectural questions.
- **`graphify-out/graph.json`**: A persistent, queryable JSON knowledge graph of the system.

### Key Architecture Communities Discovered
- **Shared Enterprise Modules**: Standard DB session builders, security schemas, auditing models in `hr_shared`.
- **Payroll Calculation Engine**: The state machine and orchestrator code inside `payroll-service`.
- **Statutory Compliance (PF/ESI/PT)**: Standard algorithms, limits, and contributions logic.
- **TDS Tax Calculation**: Slabs, investment declarations, and tests.
- **Microservices & API Gateway**: Orchestrations and routes.
- **Frontend App Shell & Components**: React components, pages, and hooks.

---

## Tests

Unit tests for the money math (run from each service dir to avoid the duplicate
`app` package name collision):

```bash
pip install -e shared pytest
cd services/compliance-service && python -m pytest -v && cd ../..
cd services/tds-service        && python -m pytest -v && cd ../..
```

End-to-end test (requires the stack to be up; auto-skips if the gateway is
unreachable):

```bash
pip install pytest
python -m pytest tests/test_e2e.py -v
```

---

## V2 roadmap (deferred)

Every seam below is marked in code with `# TODO(v2):`.

| Deferred item | Where it plugs in |
| --- | --- |
| **Form 16 generator** | `reporting-service` `POST /reports/form-16/{year}` (now writes a `FAILED` stub row). |
| **PF ECR generator** | `reporting-service` `POST /reports/pf-ecr/{cycle_id}` (now writes a `FAILED` stub row). |
| **Old-regime TDS** (80C/80D/HRA exemption, 87A, regime comparison) | `tds-service/app/logic.py` + `tds_declarations` (declarations are stored but not yet computed). |
| **Document storage** | Employee detail → Documents tab + `reporting-service` (MinIO/S3); currently a labelled placeholder. |
| **Real notification channels (Email/SMS/WhatsApp)** | `payroll-service` notification dispatch (`orchestrator.py`); in-app `notification_schema.notifications` only today. |
| **Server-synced salary templates** | Salary page "Save as template" (localStorage today). |
| **Kafka / message broker** | Replace synchronous `httpx` in `payroll-service/app/client.py` + `orchestrator.py`. |
| **Transactional Outbox + SAGA** | Wrap orchestrator state transitions; add an outbox table per service + relay worker. |
| **Redis locks / caching** | Guard concurrent `run`/`approve`; cache salary breakdowns + dashboard summaries. |
| **MFA / refresh-token rotation** | `auth-service` (`/auth/login`, token issuance in `hr_shared/auth.py`). |
| **AES-256 field encryption / KMS** | Employee PII columns (`employee-service/app/models.py`) — masked in UI + audited reveal, but plaintext at rest today. |
| **DB append-only triggers / partitioning / cold storage** | `audit_schema.audit_logs` (application-level append-only). |
| **Alembic migrations** | Each service uses `metadata.create_all` on startup (`hr_shared/service.py`); swap for `alembic upgrade head`. |
| **Real bank/NPCI payout rail** | `payout-service` (marks transactions `SUCCESS` synchronously; retry simulated). |
| **K8s / HPA / Prometheus / OpenTelemetry** | Deployment + observability layer. |
