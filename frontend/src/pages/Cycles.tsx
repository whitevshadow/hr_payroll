import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { payrollApi } from "../api/payroll";
import { qk } from "../lib/queryClient";
import { PageHeader } from "../components/PageHeader";
import { StatusBadge } from "../components/StatusBadge";
import { Modal, ModalFooter } from "../components/Modal";
import { EmptyState } from "../components/EmptyState";
import { SkeletonRow } from "../components/Spinner";
import { formatDate, formatMonth } from "../lib/format";
import { extractErrorMessage } from "../lib/toast";
import { Plus, ChevronRight, CircleDollarSign } from "lucide-react";

const WORKFLOW_STEPS = [
  { status: "DRAFT", label: "Draft", desc: "Setup" },
  { status: "LOCKED", label: "Locked", desc: "Finalized" },
  { status: "COMPUTING", label: "Computing", desc: "Processing" },
  { status: "COMPUTED", label: "Computed", desc: "Review" },
  { status: "APPROVED", label: "Approved", desc: "Signed off" },
  { status: "DISBURSED", label: "Disbursed", desc: "Complete" },
];

function WorkflowBadge({ status }: { status: string }) {
  const idx = WORKFLOW_STEPS.findIndex((s) => s.status === status);
  const isFailed = status === "FAILED";
  return (
    <div className="mb-6 flex items-center">
      {WORKFLOW_STEPS.map((step, i) => {
        const isActive = step.status === status;
        const isDone = idx >= 0 && i < idx && !isFailed;
        return (
          <div key={step.status} className="flex items-center">
            <div className="flex flex-col items-center gap-1">
              <div
                className={`h-2.5 w-2.5 rounded-full transition-all ${
                  isFailed && isActive
                    ? "bg-danger"
                    : isDone
                    ? "bg-emerald-500"
                    : isActive
                    ? "bg-accent-600 ring-2 ring-accent-200 dark:ring-accent-800"
                    : "bg-slate-200 dark:bg-slate-700"
                }`}
              />
              <span
                className={`hidden text-[9px] font-medium sm:block ${
                  isActive ? "text-accent-600 dark:text-accent-400" : "text-slate-400"
                }`}
              >
                {step.label}
              </span>
            </div>
            {i < WORKFLOW_STEPS.length - 1 && (
              <div
                className={`mx-1.5 h-px w-8 sm:w-12 transition-all ${
                  isDone ? "bg-emerald-400" : "bg-slate-200 dark:bg-slate-700"
                }`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function defaultPeriod() {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  const start = `${y}-${String(m).padStart(2, "0")}-01`;
  const last = new Date(y, m, 0).getDate();
  const end = `${y}-${String(m).padStart(2, "0")}-${last}`;
  const name = now.toLocaleString("en-US", { month: "long", year: "numeric" });
  return { name: `Payroll ${name}`, period_start: start, period_end: end };
}

export function Cycles() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState(defaultPeriod());
  const [formError, setFormError] = useState("");

  const cycles = useQuery({
    queryKey: qk.cycles,
    queryFn: () => payrollApi.listCycles(),
  });

  const createMut = useMutation({
    mutationFn: () => payrollApi.createCycle(form),
    onSuccess: (cycle) => {
      qc.invalidateQueries({ queryKey: qk.cycles });
      setShowNew(false);
      nav(`/cycles/${cycle.id}`);
    },
    onError: (err) => setFormError(extractErrorMessage(err)),
  });

  return (
    <div>
      <PageHeader
        title="Payroll Cycles"
        subtitle="Manage and run your monthly payroll"
      >
        <button className="btn" onClick={() => { setForm(defaultPeriod()); setShowNew(true); }}>
          <Plus className="h-4 w-4" />
          New Cycle
        </button>
      </PageHeader>

      {/* Workflow legend */}
      <div className="card mb-5">
        <div className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-3 uppercase tracking-wide">
          Payroll Workflow
        </div>
        <WorkflowBadge status={cycles.data?.[0]?.status ?? "DRAFT"} />
        <p className="text-xs text-slate-400 dark:text-slate-500">
          Cycles progress through: Draft → Locked → Computing → Computed → Approved → Disbursed
        </p>
      </div>

      {/* Cycles table */}
      <div className="card table-card overflow-hidden p-0">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-100 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/50">
              <th className="th">Cycle Name</th>
              <th className="th">Period</th>
              <th className="th">Status</th>
              <th className="th w-24"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50 dark:divide-slate-800/50">
            {cycles.isLoading &&
              Array.from({ length: 3 }).map((_, i) => <SkeletonRow key={i} cols={4} />)}
            {!cycles.isLoading &&
              cycles.data?.map((c, idx) => (
                <motion.tr
                  key={c.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: idx * 0.05 }}
                  className="tr-hover"
                >
                  <td className="td">
                    <div className="flex items-center gap-2">
                      <CircleDollarSign className="h-4 w-4 text-slate-300 dark:text-slate-600 shrink-0" />
                      <span className="font-medium text-slate-800 dark:text-slate-200">{c.name}</span>
                    </div>
                  </td>
                  <td className="td text-slate-500 dark:text-slate-400">
                    {formatDate(c.period_start)} → {formatDate(c.period_end)}
                  </td>
                  <td className="td">
                    <StatusBadge status={c.status} />
                  </td>
                  <td className="td">
                    <Link
                      to={`/cycles/${c.id}`}
                      className="flex items-center justify-end gap-1 text-sm font-medium text-accent-600 hover:text-accent-700 dark:text-accent-400"
                    >
                      Open <ChevronRight className="h-4 w-4" />
                    </Link>
                  </td>
                </motion.tr>
              ))}
            {!cycles.isLoading && cycles.data?.length === 0 && (
              <tr>
                <td colSpan={4}>
                  <EmptyState
                    title="No payroll cycles yet"
                    description="Create your first cycle to get started."
                    action={
                      <button className="btn" onClick={() => setShowNew(true)}>
                        <Plus className="h-4 w-4" /> New Cycle
                      </button>
                    }
                  />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Modal open={showNew} onClose={() => setShowNew(false)} title="New Payroll Cycle">
        <div className="space-y-4">
          <div>
            <label className="label" htmlFor="c-name">Cycle Name</label>
            <input id="c-name" className="input" value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="c-start">Period Start</label>
              <input id="c-start" className="input" type="date" value={form.period_start}
                onChange={(e) => setForm({ ...form, period_start: e.target.value })} />
            </div>
            <div>
              <label className="label" htmlFor="c-end">Period End</label>
              <input id="c-end" className="input" type="date" value={form.period_end}
                onChange={(e) => setForm({ ...form, period_end: e.target.value })} />
            </div>
          </div>
        </div>
        {formError && <div className="alert-danger mt-4">{formError}</div>}
        <ModalFooter
          onClose={() => setShowNew(false)}
          onSave={() => createMut.mutate()}
          saving={createMut.isPending}
          saveLabel="Create Cycle"
        />
      </Modal>
    </div>
  );
}
