import { useState } from "react";
import { useClientContext } from "../lib/ClientContext";
import { Building2, Edit2, Hash, Loader2, Plus, Users } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { employeesApi } from "../api/employees";
import { qk, STALE_STABLE } from "../lib/queryClient";
import { Modal, ModalFooter } from "../components/Modal";
import { EmptyState } from "../components/EmptyState";
import { Skeleton } from "../components/Spinner";
import { extractErrorMessage } from "../lib/toast";
import api from "../lib/api";
import type { Department } from "../types";
import clsx from "clsx";

const ROW_ANIM = {
  hidden: { opacity: 0, y: 6 },
  show:   (i: number) => ({ opacity: 1, y: 0, transition: { delay: i * 0.05, duration: 0.2 } }),
};

const DEPT_COLORS = [
  { bg: "bg-violet-50 dark:bg-violet-900/25",   text: "text-violet-600 dark:text-violet-400" },
  { bg: "bg-blue-50 dark:bg-blue-900/25",       text: "text-blue-600 dark:text-blue-400" },
  { bg: "bg-emerald-50 dark:bg-emerald-900/25", text: "text-emerald-600 dark:text-emerald-400" },
  { bg: "bg-amber-50 dark:bg-amber-900/25",     text: "text-amber-600 dark:text-amber-400" },
  { bg: "bg-pink-50 dark:bg-pink-900/25",       text: "text-pink-600 dark:text-pink-400" },
  { bg: "bg-teal-50 dark:bg-teal-900/25",       text: "text-teal-600 dark:text-teal-400" },
];

export function Departments() {
  const { selectedClientId } = useClientContext();

  const qc = useQueryClient();
  const [editing,   setEditing]   = useState<Partial<Department> | null>(null);
  const [formError, setFormError] = useState("");

  const depts = useQuery({
    queryKey: qk.departments,
    queryFn:  () => employeesApi.departments(),
    staleTime: STALE_STABLE,
  });

  const employees = useQuery({
    queryKey: qk.employees({ page_size: 200, status: "ACTIVE" }),
    queryFn:  () => employeesApi.list({ page_size: 200, status: "ACTIVE" }),
    staleTime: STALE_STABLE,
  });

  const headcount = (deptId: string) =>
    employees.data?.items.filter((e) => e.department_id === deptId).length ?? 0;

  const saveMut = useMutation({
    mutationFn: async (dept: Partial<Department>) => {
      if (!dept.name?.trim()) throw new Error("Department name is required");
      return dept.id
        ? api.put(`/departments/${dept.id}`, { name: dept.name, cost_center: dept.cost_center }).then((r) => r.data)
        : employeesApi.createDepartment(dept.name, dept.cost_center ?? undefined);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.departments });
      setEditing(null);
      setFormError("");
    },
    onError: (err) => setFormError(extractErrorMessage(err)),
  });

  function openNew() {
    setEditing({ name: "", cost_center: "" });
    setFormError("");
  }

  const isLoading = depts.isLoading;
  const list      = depts.data ?? [];

  
  if (!selectedClientId) {
    return (
      <div className="card-glass p-12 flex flex-col items-center justify-center text-center mt-6">
        <Users className="h-12 w-12 text-slate-300 mb-4" />
        <h2 className="text-lg font-bold text-slate-800 dark:text-slate-200">No Client Selected</h2>
        <p className="text-slate-500 mt-2 max-w-sm">Please select a client from the top navigation bar to proceed.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ── Page header ─────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-[26px] font-bold text-slate-900 dark:text-slate-50 leading-tight tracking-tight">
            Departments
          </h1>
          <p className="mt-1 text-[13px] text-slate-500 dark:text-slate-400">
            Manage your organisation structure
          </p>
        </div>

        <button
          onClick={openNew}
          className="btn shadow-[0_6px_20px_rgba(90,82,229,0.32)]"
        >
          <Plus className="h-3.5 w-3.5" />
          New Department
        </button>
      </div>

      {/* ── Summary strip (only when data loaded) ─────────────────────── */}
      {!isLoading && list.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className="card p-4"
          >
            <div className="kpi-label">Total Departments</div>
            <div className="kpi-value mt-1">{list.length}</div>
          </motion.div>
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.04 }}
            className="card p-4"
          >
            <div className="kpi-label">Active Employees</div>
            <div className="kpi-value mt-1">{employees.data?.total ?? "—"}</div>
          </motion.div>
        </div>
      )}

      {/* ── Main solid-surface data table ──────────────────────────────── */}
      <div className="table-card overflow-hidden">
        {/* Table header */}
        <div className="flex items-center gap-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/40 px-6 py-3">
          <div className="flex-1 text-[10px] font-semibold uppercase tracking-[0.10em] text-slate-400 dark:text-slate-500">
            Name
          </div>
          <div className="hidden sm:block w-36 text-[10px] font-semibold uppercase tracking-[0.10em] text-slate-400 dark:text-slate-500">
            Cost Centre
          </div>
          <div className="w-24 text-right text-[10px] font-semibold uppercase tracking-[0.10em] text-slate-400 dark:text-slate-500">
            Headcount
          </div>
          <div className="w-16" />
        </div>

        {/* Skeleton rows */}
        {isLoading && (
          <div className="divide-y divide-slate-50 dark:divide-slate-800/50">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-6 py-4">
                <div className="flex-1 flex items-center gap-3">
                  <Skeleton className="h-8 w-8 rounded-xl" />
                  <Skeleton className="h-3.5 w-36" />
                </div>
                <Skeleton className="hidden sm:block h-3.5 w-20" />
                <Skeleton className="h-3.5 w-8 ml-auto" />
              </div>
            ))}
          </div>
        )}

        {/* Empty state */}
        {!isLoading && list.length === 0 && (
          <EmptyState
            title="No departments yet"
            description="Create departments to organise employees by team or function."
            illustration="clipboard"
            action={
              <button
                onClick={openNew}
                className="btn shadow-[0_6px_20px_rgba(90,82,229,0.28)]"
              >
                <Plus className="h-3.5 w-3.5" />
                New Department
              </button>
            }
          />
        )}

        {/* Data rows */}
        {!isLoading && list.length > 0 && (
          <div className="divide-y divide-slate-50 dark:divide-slate-800/40">
            {list.map((d, idx) => {
              const color = DEPT_COLORS[idx % DEPT_COLORS.length];
              const count = headcount(d.id);

              return (
                <motion.div
                  key={d.id}
                  custom={idx}
                  variants={ROW_ANIM}
                  initial="hidden"
                  animate="show"
                  className="group flex items-center gap-4 px-6 py-3.5 transition-colors hover:bg-slate-50/60 dark:hover:bg-slate-800/25"
                >
                  {/* Dept icon + name */}
                  <div className="flex flex-1 items-center gap-3 min-w-0">
                    <div
                      className={clsx(
                        "flex h-8 w-8 shrink-0 items-center justify-center rounded-xl",
                        color.bg
                      )}
                    >
                      <Building2 className={clsx("h-4 w-4", color.text)} />
                    </div>
                    <div className="min-w-0">
                      <div className="text-[13.5px] font-semibold text-slate-900 dark:text-slate-100 leading-tight truncate">
                        {d.name}
                      </div>
                    </div>
                  </div>

                  {/* Cost centre */}
                  <div className="hidden sm:flex w-36 items-center gap-1.5">
                    {d.cost_center ? (
                      <>
                        <Hash className="h-3 w-3 text-slate-300 dark:text-slate-600 shrink-0" />
                        <span className="text-[12px] font-mono text-slate-500 dark:text-slate-400 truncate">
                          {d.cost_center}
                        </span>
                      </>
                    ) : (
                      <span className="text-[12px] text-slate-300 dark:text-slate-700">—</span>
                    )}
                  </div>

                  {/* Headcount */}
                  <div className="w-24 flex items-center justify-end gap-1.5">
                    <Users className="h-3.5 w-3.5 text-slate-300 dark:text-slate-700 shrink-0" />
                    <span className="text-[13px] font-semibold text-slate-700 dark:text-slate-300 tabular-nums">
                      {count}
                    </span>
                  </div>

                  {/* Edit */}
                  <div className="w-16 flex justify-end">
                    <button
                      onClick={() => { setEditing(d); setFormError(""); }}
                      className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold text-slate-400 hover:text-[#5A52E5] hover:bg-[#5A52E5]/6 dark:hover:bg-[#5A52E5]/10 transition-colors opacity-0 group-hover:opacity-100"
                    >
                      <Edit2 className="h-3 w-3" />
                      Edit
                    </button>
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Edit / Create modal ──────────────────────────────────────── */}
      {editing && (
        <Modal
          open
          onClose={() => { setEditing(null); setFormError(""); }}
          title={editing.id ? "Edit Department" : "New Department"}
          size="sm"
        >
          <div className="space-y-4">
            <div>
              <label className="label">Name *</label>
              <input
                autoFocus
                className="input"
                placeholder="e.g. Engineering"
                value={editing.name ?? ""}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                onKeyDown={(e) => e.key === "Enter" && saveMut.mutate(editing)}
              />
            </div>
            <div>
              <label className="label">Cost Centre</label>
              <input
                className="input"
                placeholder="e.g. CC-ENG"
                value={editing.cost_center ?? ""}
                onChange={(e) => setEditing({ ...editing, cost_center: e.target.value })}
              />
            </div>
            {formError && (
              <div className="alert-danger text-sm">{formError}</div>
            )}
          </div>
          <ModalFooter
            onClose={() => { setEditing(null); setFormError(""); }}
            onSave={() => saveMut.mutate(editing)}
            saving={saveMut.isPending}
            saveLabel={editing.id ? "Save Changes" : "Create Department"}
          />
        </Modal>
      )}
    </div>
  );
}
