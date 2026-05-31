# Graph Report - Hr__PAYROLL  (2026-05-31)

## Corpus Check
- 217 files · ~73,522 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1600 nodes · 4241 edges · 108 communities (89 shown, 19 thin omitted)
- Extraction: 70% EXTRACTED · 30% INFERRED · 0% AMBIGUOUS · INFERRED: 1260 edges (avg confidence: 0.53)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `e810fcc8`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_Shared Enterprise Modules|Shared Enterprise Modules]]
- [[_COMMUNITY_Payroll Calculation Engine|Payroll Calculation Engine]]
- [[_COMMUNITY_Module frontend & Frontend UI Shell|Module: frontend & Frontend UI Shell]]
- [[_COMMUNITY_Statutory Compliance (PFESI)|Statutory Compliance (PF/ESI)]]
- [[_COMMUNITY_TDS Tax Calculation|TDS Tax Calculation]]
- [[_COMMUNITY_Employee Management Service|Employee Management Service]]
- [[_COMMUNITY_Salary & Compensation Logic|Salary & Compensation Logic]]
- [[_COMMUNITY_Module frontend|Module: frontend]]
- [[_COMMUNITY_Auth & Identity Service|Auth & Identity Service]]
- [[_COMMUNITY_Frontend Pages & Views|Frontend Pages & Views]]
- [[_COMMUNITY_Reporting & Export Service|Reporting & Export Service]]
- [[_COMMUNITY_Frontend Pages & Views & Frontend API Hooks|Frontend Pages & Views & Frontend API Hooks]]
- [[_COMMUNITY_Attendance Service|Attendance Service]]
- [[_COMMUNITY_Module frontend|Module: frontend]]
- [[_COMMUNITY_Payout & Banking Integration|Payout & Banking Integration]]
- [[_COMMUNITY_Module frontend & Frontend Pages & Views|Module: frontend & Frontend Pages & Views]]
- [[_COMMUNITY_Module frontend|Module: frontend]]
- [[_COMMUNITY_Payroll Calculation Engine|Payroll Calculation Engine]]
- [[_COMMUNITY_Frontend Pages & Views|Frontend Pages & Views]]
- [[_COMMUNITY_Frontend Pages & Views|Frontend Pages & Views]]
- [[_COMMUNITY_Frontend UI Components & Module frontend|Frontend UI Components & Module: frontend]]
- [[_COMMUNITY_TDS Tax Calculation|TDS Tax Calculation]]
- [[_COMMUNITY_Payroll Calculation Engine|Payroll Calculation Engine]]
- [[_COMMUNITY_Module .claude|Module: .claude]]
- [[_COMMUNITY_Module frontend|Module: frontend]]
- [[_COMMUNITY_Docker Orchestration|Docker Orchestration]]
- [[_COMMUNITY_Module frontend|Module: frontend]]
- [[_COMMUNITY_Community 38|Community 38]]
- [[_COMMUNITY_Community 39|Community 39]]
- [[_COMMUNITY_Community 40|Community 40]]
- [[_COMMUNITY_Community 41|Community 41]]
- [[_COMMUNITY_Community 42|Community 42]]
- [[_COMMUNITY_Community 43|Community 43]]
- [[_COMMUNITY_Community 44|Community 44]]
- [[_COMMUNITY_Community 45|Community 45]]
- [[_COMMUNITY_Community 46|Community 46]]
- [[_COMMUNITY_Community 47|Community 47]]
- [[_COMMUNITY_Community 48|Community 48]]
- [[_COMMUNITY_Community 49|Community 49]]
- [[_COMMUNITY_Community 50|Community 50]]
- [[_COMMUNITY_Community 51|Community 51]]
- [[_COMMUNITY_Community 52|Community 52]]
- [[_COMMUNITY_Community 53|Community 53]]
- [[_COMMUNITY_Community 54|Community 54]]
- [[_COMMUNITY_Community 55|Community 55]]
- [[_COMMUNITY_Community 56|Community 56]]
- [[_COMMUNITY_Community 57|Community 57]]
- [[_COMMUNITY_Community 58|Community 58]]
- [[_COMMUNITY_Community 59|Community 59]]
- [[_COMMUNITY_Community 60|Community 60]]
- [[_COMMUNITY_Community 61|Community 61]]
- [[_COMMUNITY_Community 62|Community 62]]
- [[_COMMUNITY_Community 63|Community 63]]
- [[_COMMUNITY_Community 64|Community 64]]
- [[_COMMUNITY_Community 65|Community 65]]
- [[_COMMUNITY_Community 66|Community 66]]
- [[_COMMUNITY_Community 67|Community 67]]
- [[_COMMUNITY_Community 68|Community 68]]
- [[_COMMUNITY_Community 69|Community 69]]
- [[_COMMUNITY_Community 70|Community 70]]
- [[_COMMUNITY_Community 71|Community 71]]
- [[_COMMUNITY_Community 72|Community 72]]
- [[_COMMUNITY_Community 73|Community 73]]
- [[_COMMUNITY_Community 74|Community 74]]
- [[_COMMUNITY_Community 75|Community 75]]
- [[_COMMUNITY_Community 76|Community 76]]
- [[_COMMUNITY_Community 77|Community 77]]
- [[_COMMUNITY_Community 78|Community 78]]
- [[_COMMUNITY_Community 79|Community 79]]
- [[_COMMUNITY_Community 80|Community 80]]
- [[_COMMUNITY_Community 81|Community 81]]
- [[_COMMUNITY_Community 82|Community 82]]
- [[_COMMUNITY_Community 83|Community 83]]
- [[_COMMUNITY_Community 84|Community 84]]
- [[_COMMUNITY_Community 85|Community 85]]
- [[_COMMUNITY_Community 86|Community 86]]

## God Nodes (most connected - your core abstractions)
1. `RequestContext` - 47 edges
2. `datetime` - 44 edges
3. `BlobService` - 41 edges
4. `FastAPI` - 36 edges
5. `UploadResponse` - 35 edges
6. `BatchUploadResponse` - 35 edges
7. `PresignedUrlResponse` - 35 edges
8. `TenantAwareBase` - 35 edges
9. `AsyncSession` - 29 edges
10. `RequestContext` - 29 edges

## Surprising Connections (you probably didn't know these)
- `main()` --calls--> `date`  [INFERRED]
  scripts/seed.py → services/attendance-service/app/routes.py
- `_issue_token()` --calls--> `create_access_token()`  [INFERRED]
  services/auth-service/app/routes.py → shared/hr_shared/auth.py
- `_token()` --calls--> `create_access_token()`  [INFERRED]
  services/blobstore-service/tests/conftest.py → shared/hr_shared/auth.py
- `update_department()` --calls--> `audit_log()`  [INFERRED]
  services/employee-service/app/routes.py → shared/hr_shared/audit.py
- `pii_access()` --calls--> `audit_log()`  [INFERRED]
  services/employee-service/app/routes.py → shared/hr_shared/audit.py

## Hyperedges (group relationships)
- **API Gateway Route Mesh** — services_gateway_app_main_py, services_auth_service_app_main_py, services_employee_service_app_main_py, services_payroll_service_app_main_py [EXTRACTED 1.00]
- **State-driven Payroll Run Flow** — services_payroll_service_app_orchestrator_py, services_attendance_service_app_main_py, services_salary_service_app_main_py, services_tds_service_app_main_py, services_compliance_service_app_main_py, services_payout_service_app_main_py [INFERRED 0.95]

## Communities (108 total, 19 thin omitted)

### Community 0 - "Shared Enterprise Modules"
Cohesion: 0.06
Nodes (46): async_sessionmaker, AsyncEngine, DeclarativeBase, audit_log(), AuditBase, AuditLog, ensure_audit_schema(), _hash_payload() (+38 more)

### Community 1 - "Payroll Calculation Engine"
Cohesion: 0.11
Nodes (66): compute_compliance(), compute_tds(), create_payout_batch(), generate_payslips(), _get(), get_attendance(), get_my_employee(), get_salary_breakdown() (+58 more)

### Community 2 - "Module: frontend & Frontend UI Shell"
Cohesion: 0.22
Nodes (11): authApi, reportingApi, ProtectedRoute(), api, clearToken(), getToken(), ME_QUERY_KEY, setToken() (+3 more)

### Community 3 - "Statutory Compliance (PF/ESI)"
Cohesion: 0.10
Nodes (34): compute_esi(), compute_pf(), compute_pt(), ESIContribution, PFContribution, PTDeduction, Return per-employee detail + aggregates for PF, ESI, PT., summary() (+26 more)

### Community 4 - "TDS Tax Calculation"
Cohesion: 0.23
Nodes (50): DeclarationVersion, EmployeeDeclaration, EmployeeTaxProfile, Form122, Form16, ProofDocument, Investment declarations submitted by employees.      # TODO(v2): Old-regime tax, Investment declarations submitted by employees.      # TODO(v2): Old-regime tax (+42 more)

### Community 5 - "Employee Management Service"
Cohesion: 0.17
Nodes (38): Department, Employee, create_department(), create_employee(), get_employee(), get_my_employee(), list_departments(), list_employees() (+30 more)

### Community 6 - "Salary & Compensation Logic"
Cohesion: 0.16
Nodes (31): compute_breakdown(), is_metro(), Return monthly breakdown for an annual CTC.      special_allowance absorbs the, SalaryComponent, SalaryStructure, _build_structure(), _components_from_breakdown(), create_structure() (+23 more)

### Community 7 - "Module: frontend"
Cohesion: 0.08
Nodes (30): EmployeeListParams, payoutApi, DEFAULT, STATUS_MAP, StatusBadge(), StatusConfig, Stepper(), STEPS (+22 more)

### Community 8 - "Auth & Identity Service"
Cohesion: 0.19
Nodes (28): Role, Tenant, User, create_user(), CreateUserRequest, _issue_token(), login(), me() (+20 more)

### Community 9 - "Frontend Pages & Views"
Cohesion: 0.12
Nodes (32): employeesApi, payrollApi, EmptyState(), IllustrationKey, ILLUSTRATIONS, Modal(), ModalFooter(), PageHeader() (+24 more)

### Community 10 - "Reporting & Export Service"
Cohesion: 0.14
Nodes (27): GeneratedReport, _fetch_cycle(), _fetch_result(), generate_form16(), generate_payslips(), generate_pf_ecr(), get_payslip(), list_generated() (+19 more)

### Community 11 - "Frontend Pages & Views & Frontend API Hooks"
Cohesion: 0.09
Nodes (74): AuditRow, _build_object_key(), _can_view_doc(), CategoryGroup, CompletionResponse, Config, delete_employee_doc(), DocListResponse (+66 more)

### Community 12 - "Attendance Service"
Cohesion: 0.32
Nodes (15): AttendanceRecord, _first_of_month(), get_attendance(), _parse_month(), Accept YYYY-MM or YYYY-MM-DD; return the 1st of that month., upsert_manual(), AttendanceOut, AttendanceUpsert (+7 more)

### Community 13 - "Module: frontend"
Cohesion: 0.06
Nodes (30): dependencies, axios, clsx, framer-motion, lucide-react, react, react-dom, react-router-dom (+22 more)

### Community 14 - "Payout & Banking Integration"
Cohesion: 0.22
Nodes (20): PayoutBatch, PayoutTransaction, _bank_reference(), create_batch(), get_batches(), get_transactions(), _idempotency_key(), Simulated retry: re-marks a FAILED transaction as SUCCESS.      Rejects if the (+12 more)

### Community 15 - "Module: frontend & Frontend Pages & Views"
Cohesion: 0.09
Nodes (25): CsvColumn, toCSV(), computeSalaryPreview(), formatINR(), INR_FMT, METRO_CITIES, r2(), isEmployeeOnly() (+17 more)

### Community 16 - "Module: frontend"
Cohesion: 0.11
Nodes (18): compilerOptions, allowImportingTsExtensions, baseUrl, isolatedModules, jsx, lib, module, moduleResolution (+10 more)

### Community 17 - "Payroll Calculation Engine"
Cohesion: 0.10
Nodes (36): Blob, Represents a stored file blob and its associated metadata., BlobRepository, CRUD operations for :class:`Blob` ORM records., BatchUploadResponse, PresignedUrlResponse, Contains a time-limited pre-signed download URL., Returned after a successful single-file upload. (+28 more)

### Community 18 - "Frontend Pages & Views"
Cohesion: 0.11
Nodes (16): complianceApi, ComplianceSummary, daysUntil(), getNextDeadlines(), nextOccurrence(), STATUTORY_DEADLINES, StatutoryDeadline, formatINRShort() (+8 more)

### Community 19 - "Frontend Pages & Views"
Cohesion: 0.10
Nodes (19): attendanceApi, salaryApi, tdsApi, TDSCalculation, TDSDeclaration, currentMonthValue(), firstToMonth(), formatDate() (+11 more)

### Community 20 - "Frontend UI Components & Module: frontend"
Cohesion: 0.16
Nodes (47): batch_upload_blobs(), delete_blob(), download_blob(), file_exists(), get_blob_metadata(), get_blob_service(), get_notifications(), get_presigned_url() (+39 more)

### Community 21 - "TDS Tax Calculation"
Cohesion: 0.12
Nodes (30): canonical_hash(), cap(), compute_annual_tds(), compute_tds(), D(), money(), Backward-compatible V1 entrypoint used by existing tests/routes., Versioned law registry.      Slabs/deductions live here, not inside the slab eng (+22 more)

### Community 22 - "Payroll Calculation Engine"
Cohesion: 0.20
Nodes (8): assert_transition(), Payroll cycle state machine.  DRAFT -> LOCKED -> COMPUTING -> COMPUTED -> APPR, FastAPI, bytes, str, app/storage/virus_scan.py  Optional antivirus hook. When ``VIRUS_SCAN_ENABLED``, Scan *data*; raise on infection or (when fail-closed) on scanner errors., scan_or_raise()

### Community 38 - "Community 38"
Cohesion: 0.09
Nodes (28): BaseModel, LivenessResponse, ReadinessResponse, EmployeeDocCategoryGroup, EmployeeDocConfirmUpload, EmployeeDocItem, EmployeeDocListResponse, EmployeeDocRejectAction (+20 more)

### Community 39 - "Community 39"
Cohesion: 0.06
Nodes (31): SSEStatus, UsePayrollSSEOptions, AuditEvent, AuditEventSchema, CycleStatus, CycleStatusSchema, CycleSummary, CycleSummarySchema (+23 more)

### Community 40 - "Community 40"
Cohesion: 0.10
Nodes (17): AsyncClient, AsyncSession, str, auth_headers(), client(), db_session(), mock_minio(), Patch the MinIO + boto clients and the resolver used by the app. (+9 more)

### Community 41 - "Community 41"
Cohesion: 0.09
Nodes (25): CategoryGroup, CompletionResponse, DOC_CATEGORIES, DocListResponse, DocOut, DocRow(), DocStats, empDocApi (+17 more)

### Community 42 - "Community 42"
Cohesion: 0.09
Nodes (19): Notification, notificationsApi, NotificationsResponse, CommandItem, CommandPalette(), CommandPaletteProps, useCommandPalette(), useEmployeeCommands() (+11 more)

### Community 43 - "Community 43"
Cohesion: 0.11
Nodes (17): app/repositories/blob_repository.py  Data-access layer for the `blobs` table. Al, Return paginated active blobs for *tenant_id* matching the filters.          Ret, Return up to *limit* active blobs for *tenant_id*, newest first, using         k, Mark *blob* as soft-deleted by setting ``is_deleted`` to true., Clear ``is_deleted`` on a soft-deleted blob owned by *tenant_id*,         restor, Hard-delete a Blob record and commit., Update tags for *blob_id* using a server-side PostgreSQL JSONB operation., Return all blobs that were soft-deleted more than *retention_days* ago. (+9 more)

### Community 44 - "Community 44"
Cohesion: 0.10
Nodes (16): ABC, BlobStoreInterface, app/interfaces/blob_store_interface.py  Abstract storage provider interface.  Im, Upload a file and return metadata dict with bucket, key, content_type., Return a streaming response object for the given object., Return True if the object exists in the bucket, False otherwise., Generate a presigned POST URL for direct client-to-storage uploads.          Ret, Generate a presigned GET URL for time-limited direct downloads. (+8 more)

### Community 45 - "Community 45"
Cohesion: 0.21
Nodes (21): create_entry(), get_entry(), list_entries(), reconcile_stale(), update_entry(), CreateRegistryEntry, DocumentRegistry, DocumentRegistry (+13 more)

### Community 46 - "Community 46"
Cohesion: 0.13
Nodes (9): bool, str, _AsyncConnection, _AsyncConnectionContext, _FakeEngine, _FakeMinioClient, TestHealthEndpoint, TestLifespanOrdering (+1 more)

### Community 47 - "Community 47"
Cohesion: 0.13
Nodes (15): bool, int, str, _ext_from_content_type(), generate_presigned_url(), MinIOBlobStore, Wraps both the Minio SDK and boto3 S3-compatible client.      All I/O-bound bloc, Return True if the object exists.         Uses stat_object() — a HEAD request, n (+7 more)

### Community 48 - "Community 48"
Cohesion: 0.09
Nodes (22): 1) Startup workflow, 2) Upload workflow, 3) Read/download workflow, 4) Deletion workflow, API Surface, Authentication & tenant isolation, Blob routes (`/blobs`), blobstore-service (+14 more)

### Community 49 - "Community 49"
Cohesion: 0.14
Nodes (18): Minio, _apply_minio_cors(), _build_boto_client(), _build_minio_client(), delete_object(), _ensure_bucket(), get_minio_client(), init_minio() (+10 more)

### Community 50 - "Community 50"
Cohesion: 0.15
Nodes (12): alias, app/auth.py  Authentication / authorization for the Blobstore service.  The plat, Return the caller's tenant id, taken from the **verified JWT** claim.      If th, Return a dependency that requires the caller to hold one of *allowed* roles., require_roles(), require_tenant(), Header, str (+4 more)

### Community 51 - "Community 51"
Cohesion: 0.15
Nodes (17): lifespan(), _preflight_check(), Startup:       1. Configure logging       2. Initialise MinIO client and default, Probe required dependencies before running migrations/startup tasks.      Fails, close_producer(), _hash_payload(), init_producer(), ProducerUnavailable (+9 more)

### Community 52 - "Community 52"
Cohesion: 0.16
Nodes (11): Any, Minio, str, BucketResolver, bucket_resolver.py  Single source of truth for bucket naming and doc_type → fo, Apply the standard tenant-bucket policies (best-effort).          - Versioning, Resolves and auto-creates MinIO buckets., Return the bucket name for a tenant. Auto-creates if missing. (+3 more)

### Community 53 - "Community 53"
Cohesion: 0.20
Nodes (13): get_settings(), app/config.py  Centralised application settings using Pydantic V2 BaseSettings., Return cached singleton Settings instance., Strip http:// / https:// if someone sets the full URL in an env file.          _, Settings, BaseSettings, object, _install_fake_clamd() (+5 more)

### Community 54 - "Community 54"
Cohesion: 0.12
Nodes (15): Start the APScheduler background job for expired blob purges., Gracefully shut down the APScheduler instance., _start_scheduler(), _stop_scheduler(), app/scheduler.py  APScheduler background job that runs daily to permanently purg, Gracefully shut down the scheduler., Synchronous wrapper that executes the async purge coroutine in a new event loop., Synchronous wrapper that executes registry stale reconciliation. (+7 more)

### Community 55 - "Community 55"
Cohesion: 0.12
Nodes (15): Architecture, Business formulas (V1), Demo credentials, End-to-end click-path (acceptance flow), How to use Graphify, HR & Payroll SaaS — Version 1.1, Key Architecture Communities Discovered, 🕸️ Knowledge Graph (Graphify) (+7 more)

### Community 56 - "Community 56"
Cohesion: 0.20
Nodes (12): _decode_cursor(), _emit_audit_event(), _encode_cursor(), app/services/blob_service.py  Business logic layer that orchestrates between the, Return a keyset-paginated, filtered page of active blobs for *tenant_id*., Encode a ``(uploaded_at, id)`` pair into an opaque base64 cursor., Decode an opaque cursor back into ``(uploaded_at, id)``; None if absent/invalid., Fire-and-forget audit event to the audit-service ingest endpoint.      Failures (+4 more)

### Community 57 - "Community 57"
Cohesion: 0.14
Nodes (6): BaseServiceSettings, Settings, Settings, Settings, Settings, Settings

### Community 58 - "Community 58"
Cohesion: 0.26
Nodes (13): BlobOutbox, _build_envelope(), enqueue(), _hash_payload(), app/events/outbox.py  Transactional-outbox helpers.  ``enqueue`` writes a durabl, Persist a domain event to the outbox.      Call this with the same session that, Construct the standard EventEnvelope from a stored outbox row., Publish pending outbox rows to Kafka.      Returns a small summary dict ``{publi (+5 more)

### Community 59 - "Community 59"
Cohesion: 0.14
Nodes (13): 1. Executive Summary, 2. Current State (what actually works), 3. Issues & Bugs, 4. Risks, 5. Scalability Concerns, 6. Security Gaps (consolidated), 7. Spec Compliance Matrix (Success Criteria), 8. Migration Plan (phased) (+5 more)

### Community 60 - "Community 60"
Cohesion: 0.18
Nodes (11): health_live(), health_ready(), _rate_limit_key(), Returns 200 as long as the process is alive., Composite health endpoint for local and standalone development.      Returns sta, Check DB and MinIO connectivity. Returns 503 when degraded., Configure standard library structured logging., setup_logging() (+3 more)

### Community 62 - "Community 62"
Cohesion: 0.29
Nodes (9): auto_configure(), bucket_status(), CORSConfig, create_bucket(), provision_tenant(), app/api/bucket_router.py  Bucket management endpoints — backed by boto3's S3-com, CORS rules to apply to a bucket., set_cors() (+1 more)

### Community 63 - "Community 63"
Cohesion: 0.22
Nodes (7): proxy(), Lightweight FastAPI reverse proxy.  Validates the JWT (except for public auth pa, _resolve(), Response, Lightweight FastAPI reverse proxy.  Validates the JWT (except for public auth, Request, str

### Community 64 - "Community 64"
Cohesion: 0.22
Nodes (7): Action, State, ToastContext, ToastProvider(), ThemeProvider(), queryClient, ToastItem

### Community 65 - "Community 65"
Cohesion: 0.24
Nodes (9): _consume(), _handle_org_event(), app/events/event_consumer.py  Async Kafka consumer that populates an in-memory d, Gracefully cancel the consumer task., Spawn the Kafka consumer as a background asyncio task., React to organization lifecycle events.      ORG_CREATED.v1 → provision the tena, Main consumer loop.      Connects with retry logic so a temporarily unavailable, start_consumer() (+1 more)

### Community 67 - "Community 67"
Cohesion: 0.29
Nodes (6): get_db(), init_db(), app/database/db.py  Async SQLAlchemy engine and session factory. Provides:   - `, FastAPI dependency that yields a database session and ensures it is     closed a, Create all tables from the ORM models and ensure secondary indexes exist.      T, AsyncSession

### Community 68 - "Community 68"
Cohesion: 0.40
Nodes (4): _is_port_available(), standalone_stack(), bool, int

### Community 71 - "Community 71"
Cohesion: 0.60
Nodes (5): D(), _http(), End-to-end integration test: run a full payroll cycle through the gateway.  Re, test_full_cycle(), _token()

### Community 72 - "Community 72"
Cohesion: 0.80
Nodes (4): get_token(), http(), main(), str

### Community 73 - "Community 73"
Cohesion: 0.50
Nodes (3): BucketResolver, get_bucket_resolver(), Return the module-level bucket resolver.

### Community 74 - "Community 74"
Cohesion: 0.67
Nodes (3): auto_label_community(), main(), Look at the source files and names of nodes in a community to determine a beauti

### Community 76 - "Community 76"
Cohesion: 0.67
Nodes (3): bytes, download_object_stream(), Legacy sync streaming helper.

## Knowledge Gaps
- **214 isolated node(s):** `allow`, `name`, `private`, `version`, `type` (+209 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **19 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `FastAPI` connect `Payroll Calculation Engine` to `Shared Enterprise Modules`, `Payroll Calculation Engine`, `Statutory Compliance (PF/ESI)`, `TDS Tax Calculation`, `Employee Management Service`, `Salary & Compensation Logic`, `Auth & Identity Service`, `Reporting & Export Service`, `Frontend Pages & Views & Frontend API Hooks`, `Attendance Service`, `Payout & Banking Integration`, `Frontend UI Components & Module: frontend`, `Community 38`, `Community 45`, `Community 50`, `Community 51`, `Community 53`, `Community 56`, `Community 57`, `Community 60`, `Community 62`, `Community 63`, `Community 69`, `Community 70`?**
  _High betweenness centrality (0.148) - this node is a cross-community bridge._
- **Why does `datetime` connect `Payroll Calculation Engine` to `Shared Enterprise Modules`, `Community 65`, `TDS Tax Calculation`, `Employee Management Service`, `Community 38`, `Salary & Compensation Logic`, `Community 72`, `Community 71`, `Frontend Pages & Views & Frontend API Hooks`, `Attendance Service`, `Community 45`, `Community 49`, `Community 51`, `TDS Tax Calculation`, `Community 56`, `Community 58`?**
  _High betweenness centrality (0.131) - this node is a cross-community bridge._
- **Why does `Base` connect `Frontend Pages & Views & Frontend API Hooks` to `Shared Enterprise Modules`, `Community 67`, `Community 40`, `Community 45`, `Payroll Calculation Engine`?**
  _High betweenness centrality (0.028) - this node is a cross-community bridge._
- **Are the 45 inferred relationships involving `RequestContext` (e.g. with `alias` and `PresignedPostRequest`) actually correct?**
  _`RequestContext` has 45 INFERRED edges - model-reasoned connections that need verification._
- **Are the 10 inferred relationships involving `datetime` (e.g. with `ServiceCallError` and `Notification`) actually correct?**
  _`datetime` has 10 INFERRED edges - model-reasoned connections that need verification._
- **Are the 24 inferred relationships involving `BlobService` (e.g. with `PresignedPostRequest` and `BlobMetadata`) actually correct?**
  _`BlobService` has 24 INFERRED edges - model-reasoned connections that need verification._
- **Are the 2 inferred relationships involving `FastAPI` (e.g. with `LivenessResponse` and `ReadinessResponse`) actually correct?**
  _`FastAPI` has 2 INFERRED edges - model-reasoned connections that need verification._