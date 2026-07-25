import { useState } from "react";
import { useClientContext } from "../lib/ClientContext";
import { AlertCircle, Edit2, MapPin, Plus, Users } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { employeesApi } from "../api/employees";
import { PageHeader } from "../components/PageHeader";
import { Modal, ModalFooter } from "../components/Modal";
import { EmptyState } from "../components/EmptyState";
import { toastService, extractErrorMessage } from "../lib/toast";

export function Locations() {
  const { selectedClientId } = useClientContext();

  const qc = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [showInactive, setShowInactive] = useState(false);

  const locs = useQuery({
    queryKey: ["locations", !showInactive],
    queryFn: () => employeesApi.locations(!showInactive),
  });

  const toggleStatusMut = useMutation({
    mutationFn: (args: { id: string, active: boolean }) => employeesApi.updateLocation(args.id, { is_active: args.active }),
    onSuccess: () => {
      toastService.success("Location status updated");
      qc.invalidateQueries({ queryKey: ["locations"] });
    },
    onError: err => toastService.error(extractErrorMessage(err)),
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
      <PageHeader title="Work Locations" subtitle="Manage office branches, sites, and geographic operating regions.">
        <div className="flex gap-3">
          <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
            <input type="checkbox" className="rounded border-slate-300" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} />
            Show Inactive
          </label>
          <button className="btn" onClick={() => setShowModal(true)}>
            <Plus className="h-4 w-4" /> New Location
          </button>
        </div>
      </PageHeader>

      {locs.isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => <div key={i} className="card h-32 animate-pulse bg-slate-50" />)}
        </div>
      ) : locs.data?.length === 0 ? (
        <EmptyState title="No Locations Found" description="Add your first operating location to start categorizing employees." />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {locs.data?.map(l => (
            <div key={l.id} className={`card p-5 relative ${l.is_active ? '' : 'opacity-60 grayscale'}`}>
              <div className="flex items-start gap-3">
                <div className="p-2.5 rounded-xl bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400 shrink-0">
                  <MapPin className="h-5 w-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold text-slate-900 dark:text-white truncate" title={l.location_name}>{l.location_name}</h3>
                    <span className="text-xs font-mono bg-slate-100 text-slate-500 dark:bg-slate-800 px-1.5 py-0.5 rounded">{l.location_code}</span>
                  </div>
                  <div className="text-sm text-slate-500 mt-1 truncate">
                    {l.city}, {l.state} • {l.country}
                  </div>
                </div>
              </div>
              <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-800 flex justify-between items-center">
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${l.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'}`}>
                  {l.is_active ? 'Active' : 'Inactive'}
                </span>
                <button 
                  onClick={() => toggleStatusMut.mutate({ id: l.id, active: !l.is_active })}
                  className={`text-xs font-medium hover:underline ${l.is_active ? 'text-amber-600' : 'text-emerald-600'}`}
                >
                  {l.is_active ? 'Deactivate' : 'Reactivate'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showModal && <LocationModal onClose={() => setShowModal(false)} />}
    </div>
  );
}

function LocationModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [country, setCountry] = useState("India");

  const mut = useMutation({
    mutationFn: employeesApi.createLocation,
    onSuccess: () => {
      toastService.success("Location added");
      qc.invalidateQueries({ queryKey: ["locations"] });
      onClose();
    },
    onError: err => toastService.error(extractErrorMessage(err)),
  });

  return (
    <Modal open onClose={onClose} title="Add Location">
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <label className="label">Location Name</label>
            <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Bangalore HQ" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">City</label>
            <input className="input" value={city} onChange={e => setCity(e.target.value)} />
          </div>
          <div>
            <label className="label">State</label>
            <input className="input" value={state} onChange={e => setState(e.target.value)} />
          </div>
        </div>
        <div>
          <label className="label">Country</label>
          <input className="input" value={country} onChange={e => setCountry(e.target.value)} />
        </div>
      </div>
      <ModalFooter
        onClose={onClose}
        saving={mut.isPending}
        onSave={() => {
          if (!name || !city || !state || !country) return toastService.error("All fields required");
          mut.mutate({ location_name: name, city, state, country });
        }}
      />
    </Modal>
  );
}
