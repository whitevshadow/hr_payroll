import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Search, Plus, Filter, ChevronLeft, ChevronRight } from "lucide-react";
import { employeesApi } from "../api/employees";
import { qk } from "../lib/queryClient";
import { PageHeader } from "../components/PageHeader";
import { StatusBadge } from "../components/StatusBadge";
import { Modal, ModalFooter } from "../components/Modal";
import { EmptyState } from "../components/EmptyState";
import { SkeletonRow } from "../components/Spinner";
import { extractErrorMessage } from "../lib/toast";
import type { Employee } from "../types";
import clsx from "clsx";

const EMPTY_EMP: Partial<Employee> = {
  emp_code: "", first_name: "", last_name: "", email: "",
  status: "ACTIVE", work_location: "", designation: "",
  pan_number: "", bank_account: "", bank_ifsc: "", joining_date: "",
};

function validate(f: Partial<Employee>): string | null {
  if (!f.emp_code?.trim()) return "Employee code is required";
  if (!f.first_name?.trim()) return "First name is required";
  if (!f.last_name?.trim()) return "Last name is required";
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
  const [editing, setEditing] = useState<Partial<Employee> | null>(null);
  const [formError, setFormError] = useState("");
  const PAGE_SIZE = 10;

  const depts = useQuery({
    queryKey: qk.departments,
    queryFn: () => employeesApi.departments(),
  });

  const list = useQuery({
    queryKey: qk.employees({ search: search || undefined, page, page_size: PAGE_SIZE }),
    queryFn: () => employeesApi.list({ search: search || undefined, page, page_size: PAGE_SIZE }),
    placeholderData: (prev) => prev,
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
        <button className="btn" onClick={() => setEditing({ ...EMPTY_EMP })}>
          <Plus className="h-4 w-4" />
          Add Employee
        </button>
      </PageHeader>

      {/* Search bar */}
      <div className="mb-4 flex gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            className="input pl-9"
            placeholder="Search name, code, email…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          />
        </div>
      </div>

      {/* Table */}
      <div className="card table-card overflow-hidden p-0">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-100 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/50">
              <th className="th">Employee</th>
              <th className="th">Code</th>
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
                <td colSpan={6}>
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

      {/* Pagination */}
      <div className="mt-4 flex items-center justify-between">
        <span className="text-sm text-slate-500 dark:text-slate-400">
          Showing {Math.min((page - 1) * PAGE_SIZE + 1, total)}–{Math.min(page * PAGE_SIZE, total)} of {total}
        </span>
        <div className="flex items-center gap-1">
          <button
            className="btn-ghost-sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="px-3 py-1.5 text-xs text-slate-600 dark:text-slate-400">
            {page} / {pages}
          </span>
          <button
            className="btn-ghost-sm"
            disabled={page >= pages}
            onClick={() => setPage((p) => p + 1)}
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {editing && (
        <EmployeeModal
          value={editing}
          departments={depts.data ?? []}
          onClose={() => { setEditing(null); setFormError(""); }}
          onSave={() => saveMut.mutate(editing)}
          saving={saveMut.isPending}
          error={formError}
          onChange={setEditing}
        />
      )}
    </div>
  );
}

function EmployeeModal({
  value, departments, onClose, onSave, saving, error, onChange,
}: {
  value: Partial<Employee>;
  departments: { id: string; name: string }[];
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
        <div>
          <label className="label" htmlFor="f-code">Employee Code *</label>
          <input id="f-code" className="input" disabled={isEdit}
            value={value.emp_code ?? ""}
            onChange={(e) => set("emp_code", e.target.value)} />
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
          <label className="label" htmlFor="f-loc">Work Location</label>
          <input id="f-loc" className="input" placeholder="e.g. Mumbai (metro)"
            value={value.work_location ?? ""}
            onChange={(e) => set("work_location", e.target.value)} />
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
      </div>
      {error && (
        <div role="alert" className="alert-danger mt-4">{error}</div>
      )}
      <ModalFooter onClose={onClose} onSave={onSave} saving={saving} />
    </Modal>
  );
}
