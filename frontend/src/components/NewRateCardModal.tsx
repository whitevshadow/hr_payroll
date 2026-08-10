import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { employeesApi } from "../api/employees";
import { Modal, ModalFooter } from "./Modal";
import { extractErrorMessage } from "../lib/toast";
import type { DailyRateCard } from "../types";

/** Minimal rate-card creator so a daily-wage employee can be set up without
 *  leaving the employee form. Full management stays on the Rate Cards page. */
export function NewRateCardModal({
  onClose, onCreated,
}: {
  onClose: () => void;
  onCreated: (card: DailyRateCard) => void;
}) {
  const [form, setForm] = useState({
    name: "", monthly_basic: "", monthly_da: "", monthly_hra: "", bonus_pct: "8.33",
  });
  const [err, setErr] = useState("");

  const mut = useMutation({
    mutationFn: () => {
      if (!form.name.trim()) throw new Error("Give the rate card a name");
      const basic = parseFloat(form.monthly_basic);
      if (!Number.isFinite(basic) || basic <= 0) throw new Error("Monthly Basic must be greater than 0");
      return employeesApi.createRateCard({
        name: form.name.trim(),
        monthly_basic: form.monthly_basic || "0",
        monthly_da: form.monthly_da || "0",
        monthly_hra: form.monthly_hra || "0",
        bonus_pct: form.bonus_pct || "0",
        is_active: true,
      });
    },
    onSuccess: (card) => onCreated(card),
    onError: (e) => setErr(extractErrorMessage(e)),
  });

  return (
    <Modal open onClose={onClose} title="New Rate Card" size="sm">
      <div className="space-y-3">
        <div>
          <label className="label" htmlFor="nc-name">Name *</label>
          <input id="nc-name" autoFocus className="input" placeholder="e.g. Chakan Helper"
            value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </div>
        <div className="grid grid-cols-3 gap-2">
          {([["monthly_basic", "Basic / month *", "9705"],
             ["monthly_da", "DA / month", "3375"],
             ["monthly_hra", "HRA / month", "654"]] as const).map(([k, label, ph]) => (
            <div key={k}>
              <label className="label" htmlFor={`nc-${k}`}>{label}</label>
              <input id={`nc-${k}`} className="input" type="number" min="0" step="0.01" placeholder={ph}
                value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
            </div>
          ))}
        </div>
        <div className="w-1/3">
          <label className="label" htmlFor="nc-bonus">Bonus %</label>
          <input id="nc-bonus" className="input" type="number" min="0" step="0.01"
            value={form.bonus_pct} onChange={(e) => setForm({ ...form, bonus_pct: e.target.value })} />
        </div>
        <p className="text-[11px] text-[var(--text-muted)]">
          Monthly wages — payroll derives the day rate as monthly ÷ days in the month being run.
        </p>
        {err && <div className="alert-danger text-sm">{err}</div>}
      </div>
      <ModalFooter onClose={onClose} onSave={() => mut.mutate()} saving={mut.isPending} saveLabel="Create & Select" />
    </Modal>
  );
}
