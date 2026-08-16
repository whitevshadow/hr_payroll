import { lazy, Suspense, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { Search, Plus, Filter, ChevronLeft, ChevronRight, Trash2, AlertTriangle, CheckCircle2, Edit2, User, MoreHorizontal } from "lucide-react";
import { employeesApi } from "../api/employees";
import { salaryApi } from "../api/salary";
import { clientsApi } from "../api/clients";
import { qk, STALE_STABLE } from "../lib/queryClient";
import { PageHeader } from "../components/PageHeader";
import { StatusBadge } from "../components/StatusBadge";
import { Modal, ModalFooter } from "../components/Modal";
import { EmptyState } from "../components/EmptyState";
import { NewRateCardModal } from "../components/NewRateCardModal";
import { SkeletonRow } from "../components/Spinner";
import { extractErrorMessage, toastService as toast } from "../lib/toast";
import { useClientContext } from "../lib/ClientContext";
import { anchorRect } from "../lib/anchor";
import type { Employee, Department } from "../types";
import clsx from "clsx";

// Pulls in `xlsx`, which is larger than the rest of this page combined. It is
// only reachable behind the "Bulk import" button, so it should not be part of
// the Employees chunk that everyone downloads.
const BulkImportModal = lazy(() =>
  import("../components/BulkImportModal").then((m) => ({ default: m.BulkImportModal }))
);

const EMPTY_EMP: Partial<Employee> = {
  emp_code: "", first_name: "", last_name: "", email: "",
  status: "ACTIVE", work_location: "", designation: "",
  pan_number: "", bank_account: "", bank_ifsc: "", joining_date: "",
  aadhaar_number: "", gender: null,
};

function validate(f: Partial<Employee>): string | null {
  if (!f.client_id) return "Client is required";
  if (!f.first_name?.trim()) return "First name is required";
  if (!f.last_name?.trim()) return "Last name is required";
  // Aadhaar is optional — daily-wage and contract workers often have none on
  // file at onboarding. Format is still enforced when a value is supplied.
  const aadhaar = f.aadhaar_number?.trim() || "";
  if (aadhaar && !aadhaar.includes("X") && !/^\d{12}$/.test(aadhaar.replace(/\s/g, "")))
    return "Aadhaar Number must be 12 digits";
  
  if (f.pan_number && !f.pan_number.includes("#") && !f.pan_number.includes("X") && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(f.pan_number.toUpperCase()))
    return "PAN must be in the format ABCDE1234F";
  if (f.bank_ifsc && !f.bank_ifsc.includes("X") && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(f.bank_ifsc.toUpperCase()))
    return "IFSC must be in the format ABCD0123456";
  if (f.wage_type === "DAILY" && !f.daily_rate_card_id)
    return "Daily-wage employees need a rate card";
  return null;
}

function getInitials(first: string, last: string) {
  return `${first.charAt(0)}${last.charAt(0)}`.toUpperCase();
}

const AVATAR_COLORS = [
  "from-accent-400 to-accent-600",
  "from-violet-400 to-violet-600",
  "from-emerald-400 to-emerald-600",
  "from-blue-400 to-blue-600",
  "from-amber-400 to-amber-600",
  "from-pink-400 to-pink-600",
  "from-teal-400 to-teal-600",
];

// ── Row actions menu ──────────────────────────────────────────────────────────
// Collapses Edit / Delete / Profile into a single "Edit" trigger that reveals
// the other actions on click. Portalled into #popover-root so the menu isn't
// clipped by the table card's overflow-hidden (same pattern as the attendance
// grid's cell dropdown).
function RowActionsMenu({
  employee, onEdit, onDelete, triggerClassName,
}: {
  employee: Employee;
  onEdit: () => void;
  onDelete: () => void;
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  // Keeps the portal alive just long enough for the exit animation, so a row
  // with a closed menu holds no portal at all.
  const [mounted, setMounted] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);

  function openMenu() {
    if (btnRef.current) {
      // anchorRect, not getBoundingClientRect: the menu is fixed-positioned
      // inside the zoomed document, so it needs layout pixels. See lib/anchor.
      const rect = anchorRect(btnRef.current);
      const MENU_W = 170;
      // Three items, a divider and the container padding. Rounded up, so a
      // near-miss flips up rather than opening half off-screen.
      const MENU_H = 132;
      // The last grid row sits close enough to the bottom that a downward menu
      // is cut off by the viewport, so drop upward there instead — the same
      // flip the attendance grid's cell dropdown does.
      const openUp = rect.viewportH - rect.bottom < MENU_H + 8;
      setPos({
        top: openUp ? rect.top - MENU_H - 4 : rect.bottom + 4,
        left: Math.max(8, Math.min(rect.right - MENU_W, rect.viewportW - MENU_W - 8)),
      });
    }
    setMounted(true);
    setOpen(true);
  }

  const portalRoot = typeof document !== "undefined" ? document.getElementById("popover-root") : null;

  const menu = (
    <AnimatePresence onExitComplete={() => setMounted(false)}>
      {open && (
        <>
          <div className="fixed inset-0 z-[1199]" onClick={() => setOpen(false)} />
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.96 }}
            transition={{ duration: 0.12 }}
            style={{ top: pos.top, left: pos.left, width: 170 }}
            className="fixed z-[1200] rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl p-1"
          >
            <button
              onClick={() => { setOpen(false); onEdit(); }}
              className="w-full flex items-center gap-2 rounded-lg px-2.5 py-2 text-[12.5px] font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              <Edit2 className="h-3.5 w-3.5" /> Edit
            </button>
            <Link
              to={`/employees/${employee.id}`}
              onClick={() => setOpen(false)}
              className="w-full flex items-center gap-2 rounded-lg px-2.5 py-2 text-[12.5px] font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              <User className="h-3.5 w-3.5" /> View Profile
            </Link>
            <div className="my-1 h-px bg-slate-100 dark:bg-slate-800" />
            <button
              onClick={() => { setOpen(false); onDelete(); }}
              className="w-full flex items-center gap-2 rounded-lg px-2.5 py-2 text-[12.5px] font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
            >
              <Trash2 className="h-3.5 w-3.5" /> Remove
            </button>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );

  return (
    <>
      <button
        ref={btnRef}
        onClick={() => (open ? setOpen(false) : openMenu())}
        className={
          triggerClassName ??
          "flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100 px-2 py-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
        }
      >
        Edit
        <MoreHorizontal className="h-3.5 w-3.5" />
      </button>
      {mounted && (portalRoot ? createPortal(menu, portalRoot) : menu)}
    </>
  );
}

export function Employees() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const { selectedClientId, setSelectedClientId } = useClientContext();
  const [editing, setEditing] = useState<Partial<Employee> | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Employee | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const [showBulkImport, setShowBulkImport] = useState(false);
  const [formError, setFormError] = useState("");
  // Monthly CTC is not an Employee field — it becomes a salary-service
  // structure on save. Kept beside the form so one screen sets up a
  // payable employee instead of a round trip via the Salary page.
  const [ctc, setCtc] = useState("");
  const [viewMode, setViewMode] = useState<"list" | "grid">("list");
  
  // Advanced filters
  const [statusFilter, setStatusFilter] = useState("ACTIVE");
  const [deptFilter, setDeptFilter] = useState("");
  
  const PAGE_SIZE = viewMode === "list" ? 10 : 12;

  const depts = useQuery({
    queryKey: qk.departments,
    queryFn: () => employeesApi.departments(),
  });

  const locs = useQuery({
    queryKey: ["locations"],
    queryFn: () => employeesApi.locations(),
  });

  const clients = useQuery({
    queryKey: qk.clients(),
    queryFn: () => clientsApi.list({ page_size: 200, status: "ACTIVE" }),
    staleTime: STALE_STABLE,
  });

  // Scoped to the active client by the x-client-id header the API layer sends.
  const rateCards = useQuery({
    queryKey: ["rate-cards", selectedClientId],
    queryFn: () => employeesApi.rateCards(),
    staleTime: STALE_STABLE,
  });

  const list = useQuery({
    queryKey: qk.employees({ search: search || undefined, page, page_size: PAGE_SIZE, client_id: selectedClientId || undefined, status: statusFilter, department_id: deptFilter || undefined }),
    queryFn: () => employeesApi.list({ search: search || undefined, page, page_size: PAGE_SIZE, client_id: selectedClientId || undefined, status: statusFilter, department_id: deptFilter || undefined }),
    placeholderData: (prev) => prev,
  });

  // Name lookups for the table/grid. Doing these as `.find()` in the row body
  // is O(rows x clients) on every render — 12 rows against 200 clients is 2,400
  // comparisons per keystroke in the search box.
  const clientNameById = useMemo(
    () => new Map((clients.data?.items ?? []).map((c) => [c.id, c.client_name])),
    [clients.data]
  );
  const deptNameById = useMemo(
    () => new Map((depts.data ?? []).map((d: Department) => [d.id, d.name])),
    [depts.data]
  );

  const allActiveEmployees = useQuery({
    queryKey: ["employees", "all_active"],
    queryFn: () => employeesApi.list({ page_size: 1000, status: "ACTIVE" }),
  });

  // Opening the form must reset CTC: a value left over from the previous
  // employee would otherwise be written to whoever is opened next.
  function openEmployee(emp: Partial<Employee>) {
    setEditing(emp);
    setCtc("");
    setFormError("");
  }

  const saveMut = useMutation({
    mutationFn: async (emp: Partial<Employee>) => {
      const err = validate(emp);
      if (err) throw new Error(err);

      const ctcValue = parseFloat(ctc);
      const wantsSalary =
        (emp.wage_type ?? "MONTHLY") === "MONTHLY" && Number.isFinite(ctcValue) && ctcValue > 0;

      const saved = emp.id
        ? await employeesApi.update(emp.id, (({ id, emp_code, ...rest }) => rest)(emp))
        : await employeesApi.create(emp as any);

      // Salary lives in another service, so it is a second call. A failure here
      // must not read as "employee not created" — the employee exists either
      // way, and the message says exactly what still needs doing.
      if (wantsSalary) {
        try {
          await salaryApi.create({
            employee_id: saved.id,
            ctc: ctcValue,
            effective_from: emp.joining_date || new Date().toISOString().slice(0, 10),
            work_location: saved.work_location ?? emp.work_location ?? null,
          });
        } catch (e) {
          throw new Error(
            `Employee saved, but the salary structure could not be created: ${extractErrorMessage(e)}. ` +
            `Add it from the Salary page.`
          );
        }
      }
      return saved;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["employees"] });
      qc.invalidateQueries({ queryKey: ["salary"] });
      setEditing(null);
      setCtc("");
      setFormError("");
    },
    onError: (err) => setFormError(extractErrorMessage(err)),
  });

  // Deleting an employee is permanent AND leaves their payroll, attendance and
  // contribution rows orphaned in the other services (no FKs across services).
  // Separating keeps the history intact and excludes them from future runs, so
  // it is offered as the primary action.
  const separateMut = useMutation({
    mutationFn: (id: string) => employeesApi.update(id, { status: "SEPARATED" } as any),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["employees"] });
      toast.success("Employee marked as separated.");
      setConfirmDelete(null);
      setDeleteError("");
    },
    onError: (err) => setDeleteError(extractErrorMessage(err)),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => employeesApi.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["employees"] });
      toast.success("Employee deleted.");
      setConfirmDelete(null);
      setDeleteError("");
    },
    onError: (err) => setDeleteError(extractErrorMessage(err)),
  });

  const total = list.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      <PageHeader title="Employees" subtitle={`${total} total employees`}>
        <div className="flex items-center gap-2">
          <button className="btn-ghost" onClick={() => {
            if (!selectedClientId) {
              toast.error("Please select a Client from the top bar first.");
              return;
            }
            setShowBulkImport(true);
          }}>
            Bulk Import Employees
          </button>
          <button className="btn" onClick={() => openEmployee({ ...EMPTY_EMP, client_id: selectedClientId || undefined })}>
            <Plus className="h-4 w-4" />
            Add Employee
          </button>
        </div>
      </PageHeader>

      {/* Filters & Search */}
      <div className="mb-4 flex flex-col sm:flex-row gap-3 items-center">
        <div className="relative flex-1 w-full sm:max-w-xs">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            className="input pl-9"
            placeholder="Search name, code, email…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          />
        </div>
        <div className="flex-1 w-full sm:max-w-[160px]">
          <select
            className="input text-sm"
            value={selectedClientId || ""}
            onChange={(e) => {
              setSelectedClientId(e.target.value || null);
              setPage(1);
            }}
          >
            <option value="">All Clients</option>
            {clients.data?.items.map((c) => (
              <option key={c.id} value={c.id}>
                {c.client_name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex-1 w-full sm:max-w-[160px]">
          <select
            className="input text-sm"
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
          >
            <option value="">All Statuses</option>
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
            <option value="SEPARATED">Separated</option>
          </select>
        </div>
        <div className="flex-1 w-full sm:max-w-[160px]">
          <select
            className="input text-sm"
            value={deptFilter}
            onChange={(e) => { setDeptFilter(e.target.value); setPage(1); }}
          >
            <option value="">All Departments</option>
            {depts.data?.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </div>
        <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-lg shrink-0">
          <button
            onClick={() => setViewMode("list")}
            className={clsx("px-3 py-1 text-xs font-semibold rounded-md transition-colors", viewMode === "list" ? "bg-white dark:bg-slate-700 shadow-sm text-slate-900 dark:text-white" : "text-slate-500")}
          >
            List
          </button>
          <button
            onClick={() => setViewMode("grid")}
            className={clsx("px-3 py-1 text-xs font-semibold rounded-md transition-colors", viewMode === "grid" ? "bg-white dark:bg-slate-700 shadow-sm text-slate-900 dark:text-white" : "text-slate-500")}
          >
            Grid
          </button>
        </div>
      </div>

      {/* Main Content */}
      {viewMode === "list" ? (
        <div className="card table-card overflow-hidden p-0">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-100 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/50">
              <th className="th">Employee</th>
              <th className="th">Code</th>
              <th className="th">Client</th>
              <th className="th">Designation</th>
              <th className="th">Location</th>
              <th className="th">Status</th>
              <th className="th w-24"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50 dark:divide-slate-800/50">
            {list.isLoading &&
              Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} cols={6} />)}
            {!list.isLoading &&
              list.data?.items.map((e, idx) => (
                <tr key={e.id} className="tr-hover row-in">
                  <td className="td">
                    <div className="flex items-center gap-3">
                      <div
                        className={clsx(
                          "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
                          "bg-gradient-to-br text-xs font-bold text-white",
                          AVATAR_COLORS[idx % AVATAR_COLORS.length]
                        )}
                      >
                        {getInitials(e.first_name, e.last_name)}
                      </div>
                      <div>
                        <Link
                          to={`/employees/${e.id}`}
                          className="text-sm font-semibold text-slate-800 dark:text-slate-200 hover:text-accent-600 dark:hover:text-accent-400 transition-colors"
                        >
                          {e.first_name} {e.last_name}
                        </Link>
                        <div className="text-xs text-slate-400 dark:text-slate-500">
                          {e.email ?? "—"}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="td">
                    <span className="rounded-md bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-xs font-mono text-slate-600 dark:text-slate-400">
                      {e.emp_code}
                    </span>
                  </td>
                  <td className="td text-slate-600 dark:text-slate-400 text-[12px]">
                    {e.client_id
                      ? (clientNameById.get(e.client_id) ?? <span className="text-slate-300">—</span>)
                      : <span className="text-slate-300 dark:text-slate-700">—</span>}
                  </td>
                  <td className="td text-slate-600 dark:text-slate-400">
                    {e.designation ?? "—"}
                  </td>
                  <td className="td text-slate-600 dark:text-slate-400">
                    {e.work_location ?? "—"}
                  </td>
                  <td className="td">
                    <StatusBadge status={e.status} />
                  </td>
                  <td className="td">
                    <div className="flex items-center justify-end">
                      <RowActionsMenu
                        employee={e}
                        onEdit={() => openEmployee(e)}
                        onDelete={() => { setConfirmDelete(e); setDeleteError(""); }}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            {!list.isLoading && list.data?.items.length === 0 && (
              <tr>
                <td colSpan={7}>
                  <EmptyState
                    title="No employees found"
                    description={
                      search ? "Try a different search." : "Add your first employee to get started."
                    }
                    action={
                      !search ? (
                        <button className="btn" onClick={() => openEmployee({ ...EMPTY_EMP })}>
                          <Plus className="h-4 w-4" /> Add Employee
                        </button>
                      ) : undefined
                    }
                  />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {list.isLoading && Array.from({ length: 8 }).map((_, i) => <div key={i} className="card h-48 animate-pulse bg-slate-50 dark:bg-slate-800/50" />)}
          {!list.isLoading && list.data?.items.map((e, idx) => (
            <div
              key={e.id}
              className="card card-in p-5 flex flex-col hover:border-accent-200 dark:hover:border-accent-900/50 transition-colors"
            >
              <div className="flex justify-between items-start mb-4">
                <div
                  className={clsx(
                    "flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br text-base font-bold text-white shadow-sm",
                    AVATAR_COLORS[idx % AVATAR_COLORS.length]
                  )}
                >
                  {getInitials(e.first_name, e.last_name)}
                </div>
                <StatusBadge status={e.status} />
              </div>
              <Link
                to={`/employees/${e.id}`}
                className="text-base font-semibold text-slate-900 dark:text-white hover:text-accent-600 dark:hover:text-accent-400 transition-colors truncate"
              >
                {e.first_name} {e.last_name}
              </Link>
              <div className="text-xs text-slate-500 dark:text-slate-400 mt-1 truncate">
                {e.designation ?? "No Designation"} • {e.emp_code}
              </div>
              <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-800/60 flex flex-col gap-1.5 text-xs text-slate-500">
                <div className="flex justify-between truncate">
                  <span className="text-slate-400">Client:</span>
                  <span className="font-medium text-slate-700 dark:text-slate-300 truncate ml-2">
                    {e.client_id ? (clientNameById.get(e.client_id) ?? "—") : "—"}
                  </span>
                </div>
                <div className="flex justify-between truncate">
                  <span className="text-slate-400">Dept:</span>
                  <span className="font-medium text-slate-700 dark:text-slate-300 truncate ml-2">
                    {e.department_id ? (deptNameById.get(e.department_id) ?? "—") : "—"}
                  </span>
                </div>
              </div>
              <div className="mt-4">
                <RowActionsMenu
                  employee={e}
                  onEdit={() => openEmployee(e)}
                  onDelete={() => { setConfirmDelete(e); setDeleteError(""); }}
                  triggerClassName="w-full flex items-center justify-center gap-1.5 btn-secondary h-8 text-xs"
                />
              </div>
            </div>
          ))}
          {!list.isLoading && list.data?.items.length === 0 && (
            <div className="col-span-full">
              <EmptyState
                title="No employees found"
                description={
                  search ? "Try a different search." : "Add your first employee to get started."
                }
                action={
                  !search ? (
                    <button className="btn" onClick={() => openEmployee({ ...EMPTY_EMP })}>
                      <Plus className="h-4 w-4" /> Add Employee
                    </button>
                  ) : undefined
                }
              />
            </div>
          )}
        </div>
      )}

      {/* Pagination */}
      {pages > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm text-slate-500">
          <div>
            Showing {(page - 1) * PAGE_SIZE + 1} to {Math.min(page * PAGE_SIZE, total)} of {total}
          </div>
          <div className="flex gap-1">
            <button
              disabled={page === 1}
              onClick={() => setPage(p => p - 1)}
              className="btn-ghost-sm px-2"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              disabled={page === pages}
              onClick={() => setPage(p => p + 1)}
              className="btn-ghost-sm px-2"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* Add/Edit Modal */}
      {editing && (
        <EmployeeModal
          value={editing}
          departments={depts.data ?? []}
          locations={locs.data ?? []}
          clients={clients.data?.items ?? []}
          rateCards={rateCards.data ?? []}
          activeEmployees={allActiveEmployees.data?.items ?? []}
          ctc={ctc}
          onCtcChange={setCtc}
          onRateCardCreated={(card) => {
            qc.invalidateQueries({ queryKey: ["rate-cards"] });
            setEditing((e) => (e ? { ...e, daily_rate_card_id: card.id } : e));
          }}
          onClose={() => { setEditing(null); setCtc(""); setFormError(""); }}
          onSave={() => saveMut.mutate(editing)}
          saving={saveMut.isPending}
          error={formError}
          onChange={setEditing}
        />
      )}

      {/* Delete confirm modal */}
      {confirmDelete && (
        <Modal
          open
          onClose={() => setConfirmDelete(null)}
          title="Remove Employee"
          size="sm"
        >
          <div className="space-y-3">
            <p className="text-[13px] text-slate-600 dark:text-slate-300">
              How should <strong>{confirmDelete.first_name} {confirmDelete.last_name}</strong>{" "}
              ({confirmDelete.emp_code}) be removed?
            </p>
            <div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-800/40 dark:bg-emerald-900/15">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
              <div className="text-[12.5px] text-emerald-800 dark:text-emerald-300">
                <strong>Mark as separated</strong> (recommended) — keeps the employee's
                payslips and payroll history intact and excludes them from future runs.
                Reversible.
              </div>
            </div>
            <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-3 dark:border-red-800/40 dark:bg-red-900/15">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
              <div className="text-[12.5px] text-red-700 dark:text-red-300">
                <strong>Delete permanently</strong> — cannot be undone, and leaves their
                payroll results, attendance and statutory contributions orphaned in the
                other services.
              </div>
            </div>
            {deleteError && (
              <div className="alert-danger text-sm whitespace-pre-wrap">{deleteError}</div>
            )}
          </div>
          <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
            <button className="btn-ghost" onClick={() => setConfirmDelete(null)}>
              Cancel
            </button>
            <button
              className="btn-ghost text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
              disabled={deleteMut.isPending || separateMut.isPending}
              onClick={() => deleteMut.mutate(confirmDelete.id)}
            >
              {deleteMut.isPending ? "Deleting…" : "Delete permanently"}
            </button>
            <button
              className="btn"
              disabled={deleteMut.isPending || separateMut.isPending}
              onClick={() => separateMut.mutate(confirmDelete.id)}
            >
              {separateMut.isPending ? "Saving…" : "Mark as separated"}
            </button>
          </div>
        </Modal>
      )}

      {/* Bulk Import Modal */}
      {showBulkImport && (
        <Suspense fallback={null}>
          <BulkImportModal
            onClose={() => setShowBulkImport(false)}
            onImported={() => {
              setShowBulkImport(false);
              setPage(1);
              qc.invalidateQueries({ queryKey: ["employees"] });
            }}
          />
        </Suspense>
      )}
    </div>
  );
}

function EmployeeModal({
  value, departments, locations, clients, rateCards, activeEmployees,
  ctc, onCtcChange, onRateCardCreated, onClose, onSave, saving, error, onChange,
}: {
  value: Partial<Employee>;
  departments: Department[];
  locations: import("../types").Location[];
  clients: import("../types").Client[];
  rateCards: import("../types").DailyRateCard[];
  activeEmployees: Employee[];
  ctc: string;
  onCtcChange: (v: string) => void;
  onRateCardCreated: (card: import("../types").DailyRateCard) => void;
  onClose: () => void;
  onSave: () => void;
  saving: boolean;
  error: string;
  onChange: (v: Partial<Employee>) => void;
}) {
  const set = (k: keyof Employee, v: unknown) => onChange({ ...value, [k]: v });
  const isEdit = !!value.id;
  const [showNewCard, setShowNewCard] = useState(false);

  // Mirrors salary-service: monthly gross is CTC/12. Shown as a sanity check so
  // a mis-keyed annual figure is obvious before saving.
  const ctcNum = parseFloat(ctc);
  const ctcMonthly =
    Number.isFinite(ctcNum) && ctcNum > 0
      ? (ctcNum / 12).toLocaleString("en-IN", { maximumFractionDigits: 0 })
      : "";

  return (
    <Modal open onClose={onClose} title={isEdit ? "Edit Employee" : "Add Employee"} size="lg">
      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2">
          <label className="label" htmlFor="f-client">Client *</label>
          <select id="f-client" className="input" disabled={isEdit}
            value={value.client_id ?? ""}
            onChange={(e) => set("client_id", e.target.value)}>
            <option value="">-- Select Client --</option>
            {clients.map(c => (
              <option key={c.id} value={c.id}>{c.client_name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="f-status">Status</label>
          <select id="f-status" className="input" value={value.status ?? "ACTIVE"}
            onChange={(e) => set("status", e.target.value)}>
            <option>ACTIVE</option>
            <option>INACTIVE</option>
            <option>SEPARATED</option>
          </select>
        </div>
        <div>
          <label className="label" htmlFor="f-first">First Name *</label>
          <input id="f-first" className="input" value={value.first_name ?? ""}
            onChange={(e) => set("first_name", e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="f-last">Last Name *</label>
          <input id="f-last" className="input" value={value.last_name ?? ""}
            onChange={(e) => set("last_name", e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="f-email">Email</label>
          <input id="f-email" className="input" type="email" value={value.email ?? ""}
            onChange={(e) => set("email", e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="f-gender">Gender</label>
          <select id="f-gender" className="input" value={value.gender ?? ""}
            onChange={(e) => set("gender", e.target.value || null)}>
            <option value="">— Not specified —</option>
            <option value="Female">Female</option>
            <option value="Male">Male</option>
            <option value="Other">Other</option>
          </select>
          {/* Left unset this is not a cosmetic gap: Maharashtra exempts women
              earning up to Rs 25,000 from Profession Tax, so a blank here costs
              the employee Rs 200 every month. */}
          <p className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">
            Needed for the Maharashtra PT exemption for women up to ₹25,000.
          </p>
        </div>
        <div>
          <label className="label" htmlFor="f-desig">Designation</label>
          <input id="f-desig" className="input" value={value.designation ?? ""}
            onChange={(e) => set("designation", e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="f-loc">Work Location *</label>
          <select id="f-loc" className="input" value={value.location_id ?? ""}
            onChange={(e) => set("location_id", e.target.value || null)}>
            <option value="">— Select Location —</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>{l.location_name} ({l.city}, {l.state})</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="f-dept">Department</label>
          <select id="f-dept" className="input" value={value.department_id ?? ""}
            onChange={(e) => set("department_id", e.target.value || null)}>
            <option value="">—</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="f-pan">PAN</label>
          <input id="f-pan" className="input" placeholder="ABCDE1234F" value={value.pan_number ?? ""}
            onChange={(e) => set("pan_number", e.target.value.toUpperCase())} />
        </div>
        <div>
          <label className="label" htmlFor="f-aadhaar">Aadhaar Number</label>
          <input id="f-aadhaar" className="input" placeholder="123456789012" value={value.aadhaar_number ?? ""}
            onChange={(e) => set("aadhaar_number", e.target.value.replace(/\D/g, ""))} />
        </div>
        <div>
          <label className="label" htmlFor="f-bank">Bank Account</label>
          <input id="f-bank" className="input" value={value.bank_account ?? ""}
            onChange={(e) => set("bank_account", e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="f-ifsc">IFSC</label>
          <input id="f-ifsc" className="input" placeholder="HDFC0001234" value={value.bank_ifsc ?? ""}
            onChange={(e) => set("bank_ifsc", e.target.value.toUpperCase())} />
        </div>
        <div>
          <label className="label" htmlFor="f-join">Joining Date</label>
          <input id="f-join" className="input" type="date" value={value.joining_date ?? ""}
            onChange={(e) => set("joining_date", e.target.value || null)} />
        </div>
        {/* ── Wage configuration ─────────────────────────────────────────── */}
        <div>
          <label className="label" htmlFor="f-wage-type">Wage Type</label>
          <select id="f-wage-type" className="input" value={value.wage_type ?? "MONTHLY"}
            onChange={(e) => set("wage_type", e.target.value)}>
            <option value="MONTHLY">Monthly (salary structure)</option>
            <option value="DAILY">Daily rated</option>
          </select>
        </div>
        {/* Pay setup lives here so one screen produces a payable employee.
            Previously monthly staff needed a second trip to the Salary page and
            daily staff a trip to Rate Cards, which is the main reason adding
            one person felt like a three-screen process. */}
        {(value.wage_type ?? "MONTHLY") === "MONTHLY" ? (
          <div>
            <label className="label" htmlFor="f-ctc">Annual CTC (₹)</label>
            <input
              id="f-ctc"
              className="input"
              type="number"
              min="0"
              step="1000"
              placeholder="e.g. 540000"
              value={ctc}
              onChange={(e) => onCtcChange(e.target.value)}
            />
            <p className="mt-1 text-[11px] text-[var(--text-muted)]">
              {value.id
                ? "Leave blank to keep the current structure; entering a value adds a revision."
                : ctcMonthly
                  ? `≈ ₹${ctcMonthly} / month gross. A salary structure is created on save.`
                  : "Optional — you can assign salary later from the Salary page."}
            </p>
          </div>
        ) : (
          <div>
            <div className="flex items-baseline justify-between">
              <label className="label" htmlFor="f-rate-card">Rate Card *</label>
              <button
                type="button"
                onClick={() => setShowNewCard(true)}
                className="text-[11px] font-semibold text-accent-600 hover:text-accent-700 dark:text-accent-400"
              >
                + New rate card
              </button>
            </div>
            <select id="f-rate-card" className="input" value={value.daily_rate_card_id ?? ""}
              onChange={(e) => set("daily_rate_card_id", e.target.value || null)}>
              <option value="">— Select Rate Card —</option>
              {rateCards.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} (₹{c.monthly_basic}+{c.monthly_da}+{c.monthly_hra}/month)
                </option>
              ))}
            </select>
            {rateCards.length === 0 && (
              <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">
                No rate cards for this client yet — create one above without leaving this form.
              </p>
            )}
          </div>
        )}
        {/* The client is chosen by the required "Client *" field at the top of
            this form. A second control bound to the same client_id (with the
            same #f-client id) was removed: duplicate DOM ids break label
            association and the two behaved differently on edit. */}
        <div className="col-span-2">
          <label className="label" htmlFor="f-manager">Reporting Manager</label>
          <select id="f-manager" className="input" value={value.reporting_manager_id ?? ""}
            onChange={(e) => set("reporting_manager_id", e.target.value || null)}>
            <option value="">— No Manager —</option>
            {activeEmployees.filter(e => e.id !== value.id).map((e) => (
              <option key={e.id} value={e.id}>{e.first_name} {e.last_name} ({e.emp_code})</option>
            ))}
          </select>
        </div>
      </div>
      {error && (
        <div role="alert" className="alert-danger mt-4">{error}</div>
      )}

      {showNewCard && (
        <NewRateCardModal
          onClose={() => setShowNewCard(false)}
          onCreated={(card) => { setShowNewCard(false); onRateCardCreated(card); }}
        />
      )}
      <ModalFooter onClose={onClose} onSave={onSave} saving={saving} />
    </Modal>
  );
}

