# Graph Report - .  (2026-05-30)

## Corpus Check
- Corpus is ~35,956 words - fits in a single context window. You may not need a graph.

## Summary
- 742 nodes · 2068 edges · 38 communities (34 shown, 4 thin omitted)
- Extraction: 78% EXTRACTED · 22% INFERRED · 0% AMBIGUOUS · INFERRED: 457 edges (avg confidence: 0.53)
- Token cost: 12,500 input · 3,400 output

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

## God Nodes (most connected - your core abstractions)
1. `datetime` - 26 edges
2. `TenantAwareBase` - 22 edges
3. `ServiceCallError` - 21 edges
4. `RequestContext` - 21 edges
5. `AsyncSession` - 21 edges
6. `formatINR()` - 19 edges
7. `Notification` - 19 edges
8. `PayrollResult` - 19 edges
9. `UUID` - 19 edges
10. `RequestContext` - 18 edges

## Surprising Connections (you probably didn't know these)
- `_issue_token()` --calls--> `create_access_token()`  [INFERRED]
  services/auth-service/app/routes.py → shared/hr_shared/auth.py
- `update_department()` --calls--> `audit_log()`  [INFERRED]
  services/employee-service/app/routes.py → shared/hr_shared/audit.py
- `pii_access()` --calls--> `audit_log()`  [INFERRED]
  services/employee-service/app/routes.py → shared/hr_shared/audit.py
- `proxy()` --calls--> `decode_token()`  [INFERRED]
  services/gateway/app/main.py → shared/hr_shared/auth.py
- `create_batch()` --calls--> `money()`  [INFERRED]
  services/payout-service/app/routes.py → shared/hr_shared/money.py

## Hyperedges (group relationships)
- **API Gateway Route Mesh** — services_gateway_app_main_py, services_auth_service_app_main_py, services_employee_service_app_main_py, services_payroll_service_app_main_py [EXTRACTED 1.00]
- **State-driven Payroll Run Flow** — services_payroll_service_app_orchestrator_py, services_attendance_service_app_main_py, services_salary_service_app_main_py, services_tds_service_app_main_py, services_compliance_service_app_main_py, services_payout_service_app_main_py [INFERRED 0.95]

## Communities (38 total, 4 thin omitted)

### Community 0 - "Shared Enterprise Modules"
Cohesion: 0.06
Nodes (48): async_sessionmaker, AsyncEngine, BaseSettings, DeclarativeBase, audit_log(), AuditBase, AuditLog, ensure_audit_schema() (+40 more)

### Community 1 - "Payroll Calculation Engine"
Cohesion: 0.16
Nodes (48): ServiceCallError, Notification, NotificationBase, PayrollCycle, PayrollResult, approve_cycle(), _compute_for_employee(), _month_str() (+40 more)

### Community 2 - "Module: frontend & Frontend UI Shell"
Cohesion: 0.07
Nodes (37): authApi, Notification, notificationsApi, NotificationsResponse, Action, State, ToastContext, ToastProvider() (+29 more)

### Community 3 - "Statutory Compliance (PF/ESI)"
Cohesion: 0.09
Nodes (36): compute_esi(), compute_pf(), compute_pt(), ESIContribution, PFContribution, PTDeduction, Return per-employee detail + aggregates for PF, ESI, PT., summary() (+28 more)

### Community 4 - "TDS Tax Calculation"
Cohesion: 0.08
Nodes (29): compute_tds(), proxy(), Lightweight FastAPI reverse proxy.  Validates the JWT (except for public auth pa, _resolve(), Investment declarations submitted by employees.      # TODO(v2): Old-regime tax, TDSCalculation, TDSDeclaration, DeclarationIn (+21 more)

### Community 5 - "Employee Management Service"
Cohesion: 0.19
Nodes (34): Department, Employee, create_department(), create_employee(), get_employee(), get_my_employee(), list_departments(), list_employees() (+26 more)

### Community 6 - "Salary & Compensation Logic"
Cohesion: 0.17
Nodes (30): compute_breakdown(), is_metro(), Return monthly breakdown for an annual CTC.      special_allowance absorbs the r, SalaryComponent, SalaryStructure, _build_structure(), _components_from_breakdown(), create_structure() (+22 more)

### Community 7 - "Module: frontend"
Cohesion: 0.09
Nodes (29): EmployeeListParams, payoutApi, Spinner(), Stepper(), STEPS, api, Payouts(), AuditEvent (+21 more)

### Community 8 - "Auth & Identity Service"
Cohesion: 0.19
Nodes (28): Role, Tenant, User, create_user(), CreateUserRequest, _issue_token(), login(), me() (+20 more)

### Community 9 - "Frontend Pages & Views"
Cohesion: 0.11
Nodes (21): payrollApi, EmptyState(), Modal(), ModalFooter(), SkeletonRow(), formatDateTime(), qk, AuditLog() (+13 more)

### Community 10 - "Reporting & Export Service"
Cohesion: 0.14
Nodes (27): GeneratedReport, _fetch_cycle(), _fetch_result(), generate_form16(), generate_payslips(), generate_pf_ecr(), get_payslip(), list_generated() (+19 more)

### Community 11 - "Frontend Pages & Views & Frontend API Hooks"
Cohesion: 0.15
Nodes (20): attendanceApi, employeesApi, reportingApi, tdsApi, TDSCalculation, TDSDeclaration, PageHeader(), FullPageSpinner() (+12 more)

### Community 12 - "Attendance Service"
Cohesion: 0.14
Nodes (23): AttendanceRecord, _first_of_month(), get_attendance(), _parse_month(), Accept YYYY-MM or YYYY-MM-DD; return the 1st of that month., upsert_manual(), AttendanceOut, AttendanceUpsert (+15 more)

### Community 13 - "Module: frontend"
Cohesion: 0.07
Nodes (28): dependencies, axios, clsx, framer-motion, lucide-react, react, react-dom, react-router-dom (+20 more)

### Community 14 - "Payout & Banking Integration"
Cohesion: 0.20
Nodes (22): PayoutBatch, PayoutTransaction, _bank_reference(), create_batch(), get_batches(), get_transactions(), _idempotency_key(), Simulated retry: re-marks a FAILED transaction as SUCCESS.      Rejects if the t (+14 more)

### Community 15 - "Module: frontend & Frontend Pages & Views"
Cohesion: 0.14
Nodes (15): complianceApi, ComplianceSummary, CsvColumn, toCSV(), computeSalaryPreview(), formatINR(), INR_FMT, METRO_CITIES (+7 more)

### Community 16 - "Module: frontend"
Cohesion: 0.11
Nodes (18): compilerOptions, allowImportingTsExtensions, baseUrl, isolatedModules, jsx, lib, module, moduleResolution (+10 more)

### Community 17 - "Payroll Calculation Engine"
Cohesion: 0.25
Nodes (16): compute_compliance(), compute_tds(), create_payout_batch(), generate_payslips(), _get(), get_attendance(), get_my_employee(), get_salary_breakdown() (+8 more)

### Community 18 - "Frontend Pages & Views"
Cohesion: 0.15
Nodes (12): getNextDeadlines(), currentMonthFirst(), firstToMonth(), formatINRShort(), formatMonth(), monthToFirst(), relativeTime(), CARD_ANIM (+4 more)

### Community 19 - "Frontend Pages & Views"
Cohesion: 0.15
Nodes (11): salaryApi, formatDate(), maskPii(), PiiType, CycleDetail(), EmployeeDetail(), ProfileTab(), SalaryTab() (+3 more)

### Community 20 - "Frontend UI Components & Module: frontend"
Cohesion: 0.24
Nodes (9): DEFAULT, STATUS_MAP, StatusBadge(), StatusConfig, daysUntil(), nextOccurrence(), STATUTORY_DEADLINES, StatutoryDeadline (+1 more)

### Community 21 - "TDS Tax Calculation"
Cohesion: 0.53
Nodes (5): D(), Unit tests for simplified New-regime TDS slab math., test_tds_for_12L_annual(), test_tds_zero_below_threshold(), test_trace_has_all_slabs()

### Community 22 - "Payroll Calculation Engine"
Cohesion: 0.50
Nodes (3): assert_transition(), Payroll cycle state machine.  DRAFT -> LOCKED -> COMPUTING -> COMPUTED -> APPROV, str

## Knowledge Gaps
- **105 isolated node(s):** `allow`, `name`, `private`, `version`, `type` (+100 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **4 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `TenantAwareBase` connect `Statutory Compliance (PF/ESI)` to `Shared Enterprise Modules`, `Payroll Calculation Engine`, `TDS Tax Calculation`, `Employee Management Service`, `Salary & Compensation Logic`, `Auth & Identity Service`, `Reporting & Export Service`, `Attendance Service`, `Payout & Banking Integration`?**
  _High betweenness centrality (0.079) - this node is a cross-community bridge._
- **Why does `datetime` connect `Payroll Calculation Engine` to `Shared Enterprise Modules`, `Attendance Service`, `Employee Management Service`, `Salary & Compensation Logic`?**
  _High betweenness centrality (0.045) - this node is a cross-community bridge._
- **Why does `money()` connect `Statutory Compliance (PF/ESI)` to `Shared Enterprise Modules`, `Payroll Calculation Engine`, `TDS Tax Calculation`, `Salary & Compensation Logic`, `Payout & Banking Integration`?**
  _High betweenness centrality (0.029) - this node is a cross-community bridge._
- **Are the 10 inferred relationships involving `datetime` (e.g. with `ServiceCallError` and `Notification`) actually correct?**
  _`datetime` has 10 INFERRED edges - model-reasoned connections that need verification._
- **Are the 14 inferred relationships involving `ServiceCallError` (e.g. with `CycleCreate` and `datetime`) actually correct?**
  _`ServiceCallError` has 14 INFERRED edges - model-reasoned connections that need verification._
- **Are the 10 inferred relationships involving `RequestContext` (e.g. with `ServiceCallError` and `Notification`) actually correct?**
  _`RequestContext` has 10 INFERRED edges - model-reasoned connections that need verification._
- **What connects `allow`, `name`, `private` to the rest of the system?**
  _160 weakly-connected nodes found - possible documentation gaps or missing edges._