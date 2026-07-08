import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Users, Plus, Umbrella, Clock, AlertTriangle, Briefcase, FileText } from "lucide-react";
import { leaveApi, type LeavePolicy } from "../api/leave";
import { clientsApi } from "../api/clients";
import { PageHeader } from "../components/PageHeader";
import { Modal, ModalFooter } from "../components/Modal";
import { EmptyState } from "../components/EmptyState";
import { toastService, extractErrorMessage } from "../lib/toast";
import { useClientContext } from "../lib/ClientContext";
import clsx from "clsx";

const LEAVE_TYPES = [
  { id: "CASUAL", label: "Casual Leave", icon: Umbrella, color: "text-blue-600", bg: "bg-blue-100 dark:bg-blue-900/30" },
  { id: "SICK", label: "Sick Leave", icon: AlertTriangle, color: "text-red-600", bg: "bg-red-100 dark:bg-red-900/30" },
  { id: "EARNED", label: "Earned/Privilege", icon: Briefcase, color: "text-emerald-600", bg: "bg-emerald-100 dark:bg-emerald-900/30" },
  { id: "MATERNITY", label: "Maternity", icon: Clock, color: "text-purple-600", bg: "bg-purple-100 dark:bg-purple-900/30" },
  { id: "PATERNITY", label: "Paternity", icon: Clock, color: "text-indigo-600", bg: "bg-indigo-100 dark:bg-indigo-900/30" },
  { id: "UNPAID", label: "Loss of Pay", icon: FileText, color: "text-slate-600", bg: "bg-slate-100 dark:bg-slate-800" },
];

export function Leave() {
  const qc = useQueryClient();
  const { selectedClientId, setSelectedClientId } = useClientContext();
  const [showModal, setShowModal] = useState(false);
  
  const clients = useQuery({
    queryKey: ["clients"],
    queryFn: () => clientsApi.list({ page_size: 200, status: "ACTIVE" }),
  });
  
  const policies = useQuery({
    queryKey: ["leave-policies", selectedClientId],
    queryFn: () => leaveApi.listPolicies({ client_id: selectedClientId || undefined }),
  });

  const deleteMut = useMutation({
    mutationFn: leaveApi.deletePolicy,
    onSuccess: () => {
      toastService.success("Leave policy deleted");
      qc.invalidateQueries({ queryKey: ["leave-policies"] });
    },
    onError: (err) => toastService.error(extractErrorMessage(err)),
  });

  
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
      <PageHeader title="Leave Policies" subtitle="Manage organization and client-specific leave rules">
        <div className="flex gap-2">
          <select
            className="input h-9 text-sm py-1.5"
            value={selectedClientId || ""}
            onChange={(e) => setSelectedClientId(e.target.value || null)}
          >
            <option value="">Global / Internal Policies</option>
            {clients.data?.items.map((c) => (
              <option key={c.id} value={c.id}>{c.client_name}</option>
            ))}
          </select>
          <button className="btn" onClick={() => setShowModal(true)}>
            <Plus className="h-4 w-4" /> New Policy
          </button>
        </div>
      </PageHeader>

      {policies.isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="card h-40 animate-pulse bg-slate-50 dark:bg-slate-800/50" />
          ))}
        </div>
      ) : policies.data?.length === 0 ? (
        <EmptyState
          title="No Leave Policies"
          description={selectedClientId ? "No specific policies configured for this client." : "No global leave policies configured yet."}
          action={<button className="btn" onClick={() => setShowModal(true)}><Plus className="h-4 w-4" /> Create Policy</button>}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {policies.data?.map((p) => {
            const t = LEAVE_TYPES.find(x => x.id === p.leave_type) || LEAVE_TYPES[5];
            const Icon = t.icon;
            return (
              <div key={p.id} className="card p-5 flex flex-col justify-between hover:border-accent-200 dark:hover:border-accent-900/50 transition-colors">
                <div>
                  <div className="flex justify-between items-start mb-3">
                    <div className={clsx("p-2 rounded-xl", t.bg, t.color)}>
                      <Icon className="h-5 w-5" />
                    </div>
                    <span className="rounded-full px-2.5 py-0.5 text-xs font-bold tracking-wide uppercase bg-slate-100 text-slate-500 dark:bg-slate-800">
                      {p.leave_type}
                    </span>
                  </div>
                  <h3 className="font-display font-bold text-lg text-slate-900 dark:text-white mb-1">{p.name}</h3>
                  <p className="text-sm text-slate-500 dark:text-slate-400 line-clamp-2 min-h-[40px]">
                    {p.description || "No description provided."}
                  </p>
                  
                  <div className="mt-4 grid grid-cols-2 gap-3">
                    <div className="bg-slate-50 dark:bg-slate-800/40 p-2 rounded-lg">
                      <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1">Annual Quota</div>
                      <div className="font-bold font-numeric text-slate-700 dark:text-slate-200">{p.annual_allowance} days</div>
                    </div>
                    <div className="bg-slate-50 dark:bg-slate-800/40 p-2 rounded-lg">
                      <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1">Max Consecutive</div>
                      <div className="font-bold font-numeric text-slate-700 dark:text-slate-200">{p.max_consecutive_days || "No limit"}</div>
                    </div>
                  </div>
                  
                  {p.requires_document_after_days && (
                    <div className="mt-3 text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
                      <FileText className="h-3 w-3" /> Proof required after {p.requires_document_after_days} days
                    </div>
                  )}
                </div>
                
                <div className="mt-5 pt-4 border-t border-slate-100 dark:border-slate-800 flex justify-end">
                  <button
                    onClick={() => {
                      if (confirm("Deactivate this policy?")) deleteMut.mutate(p.id);
                    }}
                    className="text-xs font-medium text-red-600 hover:text-red-700"
                  >
                    Deactivate
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showModal && (
        <PolicyModal
          clientId={selectedClientId}
          onClose={() => setShowModal(false)}
        />
      )}
    </div>
  );
}

function PolicyModal({ clientId, onClose }: { clientId: string | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [type, setType] = useState("CASUAL");
  const [allowance, setAllowance] = useState(12);
  const [maxCons, setMaxCons] = useState("");
  const [reqDoc, setReqDoc] = useState("");

  const mut = useMutation({
    mutationFn: leaveApi.createPolicy,
    onSuccess: () => {
      toastService.success("Policy created");
      qc.invalidateQueries({ queryKey: ["leave-policies"] });
      onClose();
    },
    onError: (err) => toastService.error(extractErrorMessage(err)),
  });

  return (
    <Modal open onClose={onClose} title="Create Leave Policy">
      <div className="space-y-4">
        <div>
          <label className="label">Policy Name</label>
          <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Standard Casual Leave" />
        </div>
        <div>
          <label className="label">Description</label>
          <textarea className="input resize-none py-2" rows={2} value={desc} onChange={e => setDesc(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Leave Type</label>
            <select className="input" value={type} onChange={e => setType(e.target.value)}>
              {LEAVE_TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Annual Allowance (Days)</label>
            <input type="number" className="input" value={allowance} onChange={e => setAllowance(Number(e.target.value))} />
          </div>
          <div>
            <label className="label">Max Consecutive Days</label>
            <input type="number" className="input" placeholder="No limit" value={maxCons} onChange={e => setMaxCons(e.target.value)} />
          </div>
          <div>
            <label className="label">Doc Required After (Days)</label>
            <input type="number" className="input" placeholder="Not required" value={reqDoc} onChange={e => setReqDoc(e.target.value)} />
          </div>
        </div>
      </div>
      <ModalFooter
        onClose={onClose}
        saving={mut.isPending}
        onSave={() => {
          if (!name) return toastService.error("Name is required");
          mut.mutate({
            name, description: desc || undefined, leave_type: type,
            annual_allowance: allowance,
            max_consecutive_days: maxCons ? Number(maxCons) : undefined,
            requires_document_after_days: reqDoc ? Number(reqDoc) : undefined,
            client_id: clientId || undefined,
          });
        }}
      />
    </Modal>
  );
}
