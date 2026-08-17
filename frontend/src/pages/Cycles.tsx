import { useState } from "react";
import { useClientContext } from "../lib/ClientContext";
import { AlertTriangle, ChevronDown, ChevronRight, CircleDollarSign, Plus, Trash2, Users } from "lucide-react";
import clsx from "clsx";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { payrollApi } from "../api/payroll";
import { qk } from "../lib/queryClient";
import { PageHeader } from "../components/PageHeader";
import { StatusBadge } from "../components/StatusBadge";
import { Modal, ModalFooter } from "../components/Modal";
import { EmptyState } from "../components/EmptyState";
import { NoClientSelected } from "../components/NoClientSelected";
import { SkeletonRow } from "../components/Spinner";
import { formatDate, formatMonth } from "../lib/format";
import { extractErrorMessage } from "../lib/toast";
import type { PayrollCycle } from "../types";

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

/** Name a cycle after the month its period starts in, so the label can never
 *  contradict the dates (the list had a "Payroll Aug 2026" covering July). */
function nameForPeriod(periodStart: string): string {
  const d = new Date(`${periodStart}T00:00:00`);
  if (isNaN(d.getTime())) return "Payroll";
  return `Payroll ${d.toLocaleString("en-US", { month: "long", year: "numeric" })}`;
}

function defaultPeriod() {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  const start = `${y}-${String(m).padStart(2, "0")}-01`;
  const last = new Date(y, m, 0).getDate();
  const end = `${y}-${String(m).padStart(2, "0")}-${last}`;
  return { name: nameForPeriod(start), period_start: start, period_end: end };
}

/** Cycles whose period overlaps the one being created. Running two cycles over
 *  the same dates computes the same month twice, so warn before it happens. */
function overlapping(cycles: any[], start: string, end: string) {
  if (!start || !end) return [];
  return cycles.filter((c) => c.period_start <= end && c.period_end >= start);
}

export function Cycles() {
  const { selectedClientId } = useClientContext();

  const qc = useQueryClient();
  const nav = useNavigate();
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState(defaultPeriod());
  // Once the user edits the name we stop overwriting it on date changes.
  const [nameTouched, setNameTouched] = useState(false);
  const [formError, setFormError] = useState("");
  const [showAll, setShowAll] = useState(false);
  // Deleting a cycle throws away its results and statutory records, so it goes
  // through a confirmation naming the cycle rather than a bare icon click.
  const [confirmDelete, setConfirmDelete] = useState<PayrollCycle | null>(null);
  const [deleteError, setDeleteError] = useState("");

  const cycles = useQuery({
    queryKey: qk.cycles,
    queryFn: () => payrollApi.listCycles(),
  });

  // The API returns cycles newest-first (ordered by created_at desc), so the
  // most recent three are simply the head of the list. Older ones stay behind
  // the toggle to keep the page short once a client has months of history.
  const RECENT_COUNT = 3;
  const allCycles = cycles.data ?? [];
  const visibleCycles = showAll ? allCycles : allCycles.slice(0, RECENT_COUNT);
  const hiddenCount = allCycles.length - visibleCycles.length;
  const conflicts = overlapping(allCycles, form.period_start, form.period_end);

  const createMut = useMutation({
    mutationFn: () => payrollApi.createCycle(form),
    onSuccess: (cycle) => {
      qc.invalidateQueries({ queryKey: qk.cycles });
      setShowNew(false);
      nav(`/cycles/${cycle.id}`);
    },
    onError: (err) => setFormError(extractErrorMessage(err)),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => payrollApi.deleteCycle(id),
    onSuccess: (res) => {
      // The compliance registers and the ESIC/ECR panels read this cycle too,
      // so their caches go with it or they keep showing a cycle that is gone.
      qc.invalidateQueries({ queryKey: qk.cycles });
      qc.invalidateQueries({ queryKey: ["cycle-summary"] });
      qc.invalidateQueries({ queryKey: ["compliance"] });
      setConfirmDelete(null);
      setDeleteError("");
    },
    onError: (err) => setDeleteError(extractErrorMessage(err)),
  });

  
  if (!selectedClientId) {
    return <NoClientSelected feature="payroll cycles" />;
  }

  return (
    <div>
      <PageHeader
        title="Payroll Cycles"
        subtitle="Manage and run your monthly payroll"
      >
        <button className="btn" onClick={() => { setForm(defaultPeriod()); setNameTouched(false); setFormError(""); setShowNew(true); }}>
          <Plus className="h-4 w-4" />
          New Cycle
        </button>
      </PageHeader>

      {/* Workflow legend. The stepper tracks ONE cycle — the most recently
          created — not the page as a whole, so it is labelled with that
          cycle's name rather than presented as an overall status. */}
      <div className="card mb-5">
        <div className="mb-3 flex flex-wrap items-baseline gap-x-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Latest cycle
          </span>
          {allCycles[0] && (
            <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
              {allCycles[0].name}
            </span>
          )}
        </div>
        <WorkflowBadge status={allCycles[0]?.status ?? "DRAFT"} />
        <p className="text-xs text-slate-400 dark:text-slate-500">
          Cycles progress through: Draft → Locked → Computing → Computed → Approved → Disbursed
        </p>
      </div>

      {/* Cycles table */}
      <div className="card table-card overflow-x-auto p-0">
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
              visibleCycles.map((c, idx) => (
                <tr key={c.id} className="tr-hover row-in">
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
                    <div className="flex items-center justify-end gap-1">
                      <Link
                        to={`/cycles/${c.id}`}
                        className="flex items-center gap-1 text-sm font-medium text-accent-600 hover:text-accent-700 dark:text-accent-400"
                      >
                        Open <ChevronRight className="h-4 w-4" />
                      </Link>
                      {/* A disbursed cycle is the record of money that left the
                          account and the API refuses to delete it — say so on
                          the button rather than offering one that returns 409. */}
                      <button
                        type="button"
                        title={
                          c.status === "DISBURSED"
                            ? "Disbursed cycles cannot be deleted"
                            : `Delete ${c.name}`
                        }
                        aria-label={`Delete ${c.name}`}
                        disabled={c.status === "DISBURSED"}
                        onClick={() => { setDeleteError(""); setConfirmDelete(c); }}
                        className="ml-1 rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-slate-400 dark:hover:bg-red-900/20 dark:hover:text-red-400"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            {/* Older cycles stay collapsed until asked for. */}
            {!cycles.isLoading && allCycles.length > RECENT_COUNT && (
              <tr>
                <td colSpan={4} className="p-0">
                  <button
                    onClick={() => setShowAll((v) => !v)}
                    aria-expanded={showAll}
                    className="flex w-full items-center justify-center gap-1.5 py-2.5 text-sm font-medium text-accent-600 hover:text-accent-700 hover:bg-slate-50/60 dark:text-accent-400 dark:hover:bg-slate-800/30 transition-colors"
                  >
                    {showAll
                      ? "Show less"
                      : `Show ${hiddenCount} older ${hiddenCount === 1 ? "cycle" : "cycles"}`}
                    <ChevronDown
                      className={clsx(
                        "h-4 w-4 transition-transform duration-200",
                        showAll && "rotate-180"
                      )}
                    />
                  </button>
                </td>
              </tr>
            )}
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
              onChange={(e) => { setNameTouched(true); setForm({ ...form, name: e.target.value }); }} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="c-start">Period Start</label>
              <input id="c-start" className="input" type="date" value={form.period_start}
                onChange={(e) => setForm((f) => ({
                  ...f,
                  period_start: e.target.value,
                  name: nameTouched ? f.name : nameForPeriod(e.target.value),
                }))} />
            </div>
            <div>
              <label className="label" htmlFor="c-end">Period End</label>
              <input id="c-end" className="input" type="date" value={form.period_end}
                onChange={(e) => setForm({ ...form, period_end: e.target.value })} />
            </div>
          </div>
          {/* Overlap guard: creating a second cycle over the same dates is the
              usual cause of duplicate "Payroll July" rows that compute the
              same month twice. Warn, but let the user proceed deliberately. */}
          {conflicts.length > 0 && (
            <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 dark:border-amber-800/40 dark:bg-amber-900/15">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
              <div className="text-[12.5px] text-amber-800 dark:text-amber-300">
                This period overlaps {conflicts.length === 1 ? "an existing cycle" : `${conflicts.length} existing cycles`}:{" "}
                <strong>{conflicts.map((c) => c.name).join(", ")}</strong>. Running
                both computes the same month twice — check you aren't duplicating one.
              </div>
            </div>
          )}
        </div>
        {formError && <div className="alert-danger mt-4">{formError}</div>}
        <ModalFooter
          onClose={() => setShowNew(false)}
          onSave={() => createMut.mutate()}
          saving={createMut.isPending}
          saveLabel="Create Cycle"
        />
      </Modal>

      {/* Delete confirmation. Spells out what goes with the cycle, because the
          statutory records are in other services and are not obvious from a
          page that only lists cycles. */}
      <Modal
        open={!!confirmDelete}
        onClose={() => { setConfirmDelete(null); setDeleteError(""); }}
        title="Delete payroll cycle?"
      >
        {confirmDelete && (
          <div className="space-y-4">
            <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-3 dark:border-red-800/50 dark:bg-red-900/15">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
              <div className="text-[13px] text-red-700 dark:text-red-400">
                <div className="font-semibold">
                  {confirmDelete.name} — {formatDate(confirmDelete.period_start)} to{" "}
                  {formatDate(confirmDelete.period_end)}
                </div>
                <p className="mt-1">This cannot be undone.</p>
              </div>
            </div>

            <div className="text-[13px] text-slate-600 dark:text-slate-400">
              <div className="font-semibold text-slate-700 dark:text-slate-300">
                Deleting this cycle also removes:
              </div>
              <ul className="mt-1.5 list-disc space-y-0.5 pl-5">
                <li>every payslip result computed in it</li>
                <li>its PF, ESI, PT and LWF records, and the ESIC and ECR returns built from them</li>
                <li>its paysheet</li>
              </ul>
              <p className="mt-2">
                Attendance for the period is <strong>not</strong> touched — you can run the
                cycle again from the same data.
              </p>
            </div>

            {deleteError && <div className="alert-danger">{deleteError}</div>}

            <ModalFooter
              onClose={() => { setConfirmDelete(null); setDeleteError(""); }}
              onSave={() => deleteMut.mutate(confirmDelete.id)}
              saving={deleteMut.isPending}
              saveLabel="Delete Cycle"
              danger
            />
          </div>
        )}
      </Modal>
    </div>
  );
}
