import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Calendar, Plus, CheckCircle, Clock } from "lucide-react";
import { employeesApi } from "../api/employees";
import { PageHeader } from "../components/PageHeader";
import { Modal, ModalFooter } from "../components/Modal";
import { EmptyState } from "../components/EmptyState";
import { toastService, extractErrorMessage } from "../lib/toast";
import { formatDate } from "../lib/format";

export function FinancialYears() {
  const qc = useQueryClient();
  const [showModal, setShowModal] = useState(false);

  const fys = useQuery({
    queryKey: ["financial-years"],
    queryFn: employeesApi.financialYears,
  });

  const activateMut = useMutation({
    mutationFn: employeesApi.activateFinancialYear,
    onSuccess: () => {
      toastService.success("Financial year activated");
      qc.invalidateQueries({ queryKey: ["financial-years"] });
    },
    onError: err => toastService.error(extractErrorMessage(err)),
  });

  return (
    <div className="space-y-6">
      <PageHeader title="Financial Years" subtitle="Manage fiscal calendars and reporting periods.">
        <button className="btn" onClick={() => setShowModal(true)}>
          <Plus className="h-4 w-4" /> Add FY
        </button>
      </PageHeader>

      {fys.isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => <div key={i} className="card h-28 animate-pulse bg-slate-50" />)}
        </div>
      ) : fys.data?.length === 0 ? (
        <EmptyState title="No Financial Years" description="Create a financial year to start managing payroll and leave balances." />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {fys.data?.map(fy => (
            <div key={fy.id} className={`card p-5 relative border-2 ${fy.is_active ? 'border-emerald-500/30 bg-emerald-50/10' : 'border-transparent'}`}>
              {fy.is_active && (
                <div className="absolute top-3 right-3 flex items-center gap-1.5 text-xs font-bold text-emerald-600 bg-emerald-100 px-2.5 py-1 rounded-full">
                  <CheckCircle className="h-3.5 w-3.5" /> ACTIVE
                </div>
              )}
              <div className="flex items-center gap-3 mb-4">
                <div className={`p-2.5 rounded-xl shrink-0 ${fy.is_active ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-100 text-slate-500'}`}>
                  <Calendar className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="font-display font-bold text-lg text-slate-900 dark:text-white">{fy.year_label}</h3>
                  <p className="text-xs text-slate-500 font-medium">Fiscal Period</p>
                </div>
              </div>
              
              <div className="flex items-center justify-between text-sm text-slate-600 dark:text-slate-300 font-medium bg-slate-50 dark:bg-slate-800/50 p-3 rounded-xl border border-slate-100 dark:border-slate-700">
                <div className="flex flex-col">
                  <span className="text-[10px] text-slate-400 uppercase tracking-wider mb-0.5">Start</span>
                  {formatDate(fy.start_date)}
                </div>
                <div className="h-8 w-px bg-slate-200 dark:bg-slate-700" />
                <div className="flex flex-col text-right">
                  <span className="text-[10px] text-slate-400 uppercase tracking-wider mb-0.5">End</span>
                  {formatDate(fy.end_date)}
                </div>
              </div>

              {!fy.is_active && (
                <button 
                  onClick={() => { if (confirm("Activate this Financial Year? All current active ones will be deactivated.")) activateMut.mutate(fy.id) }}
                  className="mt-4 w-full flex items-center justify-center gap-2 text-sm font-semibold text-emerald-600 border border-emerald-200 hover:bg-emerald-50 py-2 rounded-xl transition-colors"
                >
                  <Clock className="h-4 w-4" /> Make Active
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {showModal && <FYModal onClose={() => setShowModal(false)} />}
    </div>
  );
}

function FYModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [label, setLabel] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [isActive, setIsActive] = useState(false);

  const mut = useMutation({
    mutationFn: employeesApi.createFinancialYear,
    onSuccess: () => {
      toastService.success("Financial Year created");
      qc.invalidateQueries({ queryKey: ["financial-years"] });
      onClose();
    },
    onError: err => toastService.error(extractErrorMessage(err)),
  });

  return (
    <Modal open onClose={onClose} title="Create Financial Year">
      <div className="space-y-4">
        <div>
          <label className="label">Year Label</label>
          <input className="input" value={label} onChange={e => setLabel(e.target.value)} placeholder="e.g. FY 2025-26" />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Start Date</label>
            <input type="date" className="input" value={start} onChange={e => setStart(e.target.value)} />
          </div>
          <div>
            <label className="label">End Date</label>
            <input type="date" className="input" value={end} onChange={e => setEnd(e.target.value)} />
          </div>
        </div>
        <label className="flex items-center gap-2 mt-4 bg-slate-50 p-3 rounded-lg border border-slate-100 cursor-pointer">
          <input type="checkbox" className="rounded text-accent h-4 w-4 border-slate-300" checked={isActive} onChange={e => setIsActive(e.target.checked)} />
          <div>
            <div className="font-semibold text-sm">Set as Active FY</div>
            <div className="text-xs text-slate-500">Will automatically deactivate currently active FYs.</div>
          </div>
        </label>
      </div>
      <ModalFooter
        onClose={onClose}
        saving={mut.isPending}
        onSave={() => {
          if (!label || !start || !end) return toastService.error("All fields required");
          mut.mutate({ year_label: label, start_date: start, end_date: end, is_active: isActive });
        }}
      />
    </Modal>
  );
}
