# Deploy — Step by Step

> The condensed, do-this-then-that version of deploying the platform. For the *why* behind each
> step, hardening details, and scaling notes, read the full
> [DEPLOYMENT_GUIDE.md](../DEPLOYMENT_GUIDE.md) — this checklist links into it throughout.

**What you're deploying:** one `docker compose up` brings up the entire platform — the React
frontend (nginx), the API gateway, 11 FastAPI backend services, PostgreSQL, and MinIO — already
wired together on one Docker network. Only two ports face the outside world: **4050** (the app)
and **4000** (the gateway). Everything else (Postgres, MinIO, every backend service) is
intentionally unreachable from the host.

---

## Part 1 — Prerequisites

| # | Check | How |
|---|-------|-----|
| 1 | Docker Engine + Compose v2 | `docker compose version` prints a version. On Windows/macOS install **Docker Desktop**; on a Linux server install Docker Engine + the compose plugin. |
| 2 | Python 3 on the host | `python --version` — only needed for `scripts/setup_env.py` and `scripts/seed.py`. |
| 3 | Enough machine | Comfortable minimum **4 vCPU / 8 GB RAM / 20 GB disk** (15 containers; PDF rendering spikes hardest). |
| 4 | Ports 4050 and 4000 free | And, for a real server, reachable through your firewall. **Do not** open/publish any other ports. |

> **Windows note:** run every command below from PowerShell or Git Bash in the repo root. In
> PowerShell use `curl.exe` (not the `curl` alias) for the health checks.

---

## Part 2 — First deployment (local machine or a single server)

### Step 1 — Get the code

```bash
git clone <your-repo-url>
cd hr_payroll
```

### Step 2 — Create `.env` with real secrets

```bash
python scripts/setup_env.py
```

This copies `.env.example` → `.env` and fills every `CHANGE_ME_*` placeholder with a
cryptographically random value (`JWT_SECRET`, `FIELD_ENCRYPTION_KEY`, MinIO root + service
credentials). It refuses to overwrite an existing `.env`, so it's safe to run once after cloning.
Prefer doing it by hand? The generation commands are documented at the top of
[.env.example](../.env.example).

**Never commit `.env`** — it's git-ignored on purpose. `docker compose` will refuse to start if
the required secrets are missing, which is your safety net.

### Step 3 — Build and start everything

```bash
docker compose up -d --build
```

First build takes several minutes. Startup order is handled for you: Postgres must be *healthy*
before services start; `minio-init` runs once to provision MinIO's least-privilege service
account; each service creates its own database schema and tables on boot — **there is no separate
migration step**.

### Step 4 — Confirm it came up

```bash
docker compose ps
```

Every container should show `Up` (Postgres and MinIO with `(healthy)`, `minio-init` as
`Exited (0)` — it's a one-shot job). Then:

```bash
curl http://localhost:4000/health
```

Expected: `{"status":"ok","service":"gateway"}`. If either check fails, see
[DEPLOYMENT_GUIDE.md §7 — Troubleshooting](../DEPLOYMENT_GUIDE.md#7-troubleshooting-connectivity-problems)
before going further.

### Step 5 — (Optional) Seed demo data

```bash
python scripts/seed.py
```

Registers a demo tenant, admin user, a client company, and sample employees via the gateway, then
prints the login — by default **`admin@demo.com` / `Admin@123`**. Skip this in production and
register your real tenant in the app instead (`/login` → Register).

### Step 6 — Open the app

Browse to **http://localhost:4050** (or `http://<server-ip>:4050`). Log in with the seeded
credentials or your registered tenant.

### Step 7 — Smoke-test the real workflows

Don't stop at "the page loads." Walk the 10-step checklist in
[DEPLOYMENT_GUIDE.md §5](../DEPLOYMENT_GUIDE.md#5-verifying-it-actually-works-smoke-test) — create
a client → employee → salary → attendance → **run a payroll cycle** → approve → open a payslip
PDF. The payroll run is the single most cross-service action in the app; if it succeeds, the whole
stack is wired correctly. (If a client has no CTC set up, use **Import Excel Register** on the
cycle page instead of Run Payroll — see
[EXCEL_PAYROLL_IMPORT_FEATURE.md](../EXCEL_PAYROLL_IMPORT_FEATURE.md).)

---

## Part 3 — Before real users touch it (production checklist)

The compose file is built for "one server, running correctly" — do these before putting real
payroll data on it. Full detail in
[DEPLOYMENT_GUIDE.md §6](../DEPLOYMENT_GUIDE.md#6-production-hardening-checklist).

- [ ] **TLS in front of port 4050.** Nothing terminates HTTPS out of the box. Put Caddy / nginx /
      your cloud load balancer in front, and never expose 4050 to the internet unencrypted — JWTs
      and PII flow over it.
- [ ] **Fresh secrets per environment.** Re-run `scripts/setup_env.py` on the server; never reuse
      a dev `.env`. Store it in a secrets manager, not the repo.
- [ ] **Changed the Postgres password?** Also edit `DATABASE_URL` in `docker-compose.yml`'s
      `x-common-env` block — it hardcodes `hr:hr` and does *not* read your `.env` override.
- [ ] **Restart policy:** add `restart: unless-stopped` to services so the stack survives reboots.
- [ ] **Back up the two volumes that matter:** `pgdata` (all application data) and `minio-data`
      (every uploaded document and payslip PDF). Losing either is unrecoverable.
- [ ] **Frontend and gateway on different domains?** (Not the default — avoid if you can.) Then
      update the gateway's CORS allow-list, build the frontend with `VITE_API_BASE`, and set
      `MINIO_CORS_ALLOW_ORIGIN` — all three together, per
      [§6 of the full guide](../DEPLOYMENT_GUIDE.md#6-production-hardening-checklist).

---

## Part 4 — Redeploying after a code change

Rebuild only what you touched:

```bash
# UI change
docker compose build frontend && docker compose up -d frontend

# One backend service
docker compose build payroll-service && docker compose up -d payroll-service

# Changed shared/hr_shared/ → every Python service bakes in its own copy: rebuild all
docker compose build && docker compose up -d
```

Changed `JWT_SECRET`? Restart the **whole** stack (`docker compose up -d --force-recreate`) or
every request will 401.

---

## Part 5 — Quick fixes

| Symptom | First move |
|---|---|
| `502` on `/api/v1/...` | `docker compose ps` → find the container that isn't `Up` → `docker compose logs <service>` |
| Everything 401s | `JWT_SECRET` changed without a full restart → `docker compose up -d --force-recreate` |
| CORS errors | You split frontend/gateway across domains without the §6 changes above |
| Payslip/file errors | `docker compose logs minio-init` — MinIO credentials mismatch |
| Payroll run fails | `docker compose logs payroll-service` — it names which downstream service call failed |

Full table with causes and fixes:
[DEPLOYMENT_GUIDE.md §7](../DEPLOYMENT_GUIDE.md#7-troubleshooting-connectivity-problems).
