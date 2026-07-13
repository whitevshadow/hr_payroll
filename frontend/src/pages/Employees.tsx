import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Search, Plus, Filter, ChevronLeft, ChevronRight } from "lucide-react";
import { employeesApi } from "../api/employees";
import { clientsApi } from "../api/clients";
import { qk, STALE_STABLE } from "../lib/queryClient";
import { PageHeader } from "../components/PageHeader";
import { StatusBadge } from "../components/StatusBadge";
import { Modal, ModalFooter } from "../components/Modal";
import { EmptyState } from "../components/EmptyState";
import { SkeletonRow } from "../components/Spinner";
import { BulkImportModal } from "../components/BulkImportModal";
import { extractErrorMessage, toastService as toast } from "../lib/toast";
import { useClientContext } from "../lib/ClientContext";
import type { Employee, Department } from "../types";
import clsx from "clsx";

const EMPTY_EMP: Partial<Employee> = {
  emp_code: "", first_name: "", last_name: "", email: "",
  status: "ACTIVE", work_location: "", designation: "",
  pan_number: "", bank_account: "", bank_ifsc: "", joining_date: "",
  aadhaar_number: "",
};

function validate(f: Partial<Employee>): string | null {
  if (!f.client_id) return "Client is required";
  if (!f.first_name?.trim()) return "First name is required";
  if (!f.last_name?.trim()) return "Last name is required";
  if (!f.aadhaar_number?.trim()) return "Aadhaar Number is required";
  if (!/^\d{12}$/.test(f.aadhaar_number.trim())) return "Aadhaar Number must be 12 digits";
  if (f.pan_number && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(f.pan_number.toUpperCase()))
    return "PAN must be in the format ABCDE1234F";
  if (f.bank_ifsc && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(f.bank_ifsc.toUpperCase()))
    return "IFSC must be in the format ABCD0123456";
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

export function Employees() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const { selectedClientId, setSelectedClientId } = useClientContext();
  const [editing, setEditing] = useState<Partial<Employee> | null>(null);
  const [showBulkImport, setShowBulkImport] = useState(false);
  const [formError, setFormError] = useState("");
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

  const list = useQuery({
    queryKey: qk.employees({ search: search || undefined, page, page_size: PAGE_SIZE, client_id: selectedClientId || undefined, status: statusFilter, department_id: deptFilter || undefined }),
    queryFn: () => employeesApi.list({ search: search || undefined, page, page_size: PAGE_SIZE, client_id: selectedClientId || undefined, status: statusFilter, department_id: deptFilter || undefined }),
    placeholderData: (prev) => prev,
  });

  const allActiveEmployees = useQuery({
    queryKey: ["employees", "all_active"],
    queryFn: () => employeesApi.list({ page_size: 1000, status: "ACTIVE" }),
  });

  const saveMut = useMutation({
    mutationFn: async (emp: Partial<Employee>) => {
      const err = validate(emp);
      if (err) throw new Error(err);
      if (emp.id) {
        const { id, emp_code, ...rest } = emp;
        return employeesApi.update(id, rest);
      }
      return employeesApi.create(emp as any);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["employees"] });
      setEditing(null);
      setFormError("");
    },
    onError: (err) => setFormError(extractErrorMessage(err)),
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
          <button className="btn" onClick={() => setEditing({ ...EMPTY_EMP, client_id: selectedClientId || undefined })}>
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
                <motion.tr
                  key={e.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: idx * 0.03 }}
                  className="tr-hover"
                >
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
                      ? (clients.data?.items.find((c) => c.id === e.client_id)?.client_name ?? <span className="text-slate-300">—</span>)
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
                    <div className="flex items-center justify-end gap-3">
                      <button
                        className="text-xs font-medium text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
                        onClick={() => setEditing(e)}
                      >
                        Edit
                      </button>
                      <Link
                        to={`/employees/${e.id}`}
                        className="text-xs font-medium text-accent-600 hover:text-accent-700 dark:text-accent-400 transition-colors"
                      >
                        Profile →
                      </Link>
                    </div>
                  </td>
                </motion.tr>
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
                        <button className="btn" onClick={() => setEditing({ ...EMPTY_EMP })}>
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
            <motion.div
              key={e.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.02 }}
              className="card p-5 flex flex-col hover:border-accent-200 dark:hover:border-accent-900/50 transition-colors"
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
                    {e.client_id ? (clients.data?.items.find((c) => c.id === e.client_id)?.client_name ?? "—") : "—"}
                  </span>
                </div>
                <div className="flex justify-between truncate">
                  <span className="text-slate-400">Dept:</span>
                  <span className="font-medium text-slate-700 dark:text-slate-300 truncate ml-2">
                    {e.department_id ? (depts.data?.find((d) => d.id === e.department_id)?.name ?? "—") : "—"}
                  </span>
                </div>
              </div>
              <div className="mt-4 flex gap-2">
                <button
                  className="flex-1 btn-secondary h-8 text-xs"
                  onClick={() => setEditing(e)}
                >
                  Edit
                </button>
                <Link
                  to={`/employees/${e.id}`}
                  className="flex-1 btn h-8 text-xs bg-slate-900 text-white dark:bg-white dark:text-slate-900 hover:bg-slate-800 dark:hover:bg-slate-100"
                >
                  Profile
                </Link>
              </div>
            </motion.div>
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
                    <button className="btn" onClick={() => setEditing({ ...EMPTY_EMP })}>
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
          activeEmployees={allActiveEmployees.data?.items ?? []}
          onClose={() => { setEditing(null); setFormError(""); }}
          onSave={() => saveMut.mutate(editing)}
          saving={saveMut.isPending}
          error={formError}
          onChange={setEditing}
        />
      )}

      {/* Bulk Import Modal */}
      {showBulkImport && (
        <BulkImportModal
          onClose={() => setShowBulkImport(false)}
          onImported={() => {
            setShowBulkImport(false);
            setPage(1);
            qc.invalidateQueries({ queryKey: ["employees"] });
          }}
        />
      )}
    </div>
  );
}

function EmployeeModal({
  value, departments, locations, clients, activeEmployees, onClose, onSave, saving, error, onChange,
}: {
  value: Partial<Employee>;
  departments: Department[];
  locations: import("../types").Location[];
  clients: import("../types").Client[];
  activeEmployees: Employee[];
  onClose: () => void;
  onSave: () => void;
  saving: boolean;
  error: string;
  onChange: (v: Partial<Employee>) => void;
}) {
  const set = (k: keyof Employee, v: unknown) => onChange({ ...value, [k]: v });
  const isEdit = !!value.id;

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
          <label className="label" htmlFor="f-aadhaar">Aadhaar Number *</label>
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
      <ModalFooter onClose={onClose} onSave={onSave} saving={saving} />
    </Modal>
  );
}
