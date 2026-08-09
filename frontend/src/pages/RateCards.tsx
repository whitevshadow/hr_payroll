import { useState } from "react";
import { useClientContext } from "../lib/ClientContext";
import { Edit2, Plus, Users, Coins } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { employeesApi } from "../api/employees";
import { STALE_STABLE } from "../lib/queryClient";
import { Modal, ModalFooter } from "../components/Modal";
import { EmptyState } from "../components/EmptyState";
import { NoClientSelected } from "../components/NoClientSelected";
import { Skeleton } from "../components/Spinner";
import { extractErrorMessage } from "../lib/toast";
import type { DailyRateCard } from "../types";

const BLANK: Partial<DailyRateCard> = {
  name: "", monthly_basic: "", monthly_da: "", monthly_hra: "",
  bonus_pct: "", is_active: true,
};

/** Sum of the monthly earning heads — what a full month's attendance earns
 *  before bonus. */
function monthlyTotal(c: Pick<DailyRateCard, "monthly_basic" | "monthly_da" | "monthly_hra">): number {
  return (parseFloat(c.monthly_basic) || 0) + (parseFloat(c.monthly_da) || 0) + (parseFloat(c.monthly_hra) || 0);
}

/** Day rate payroll will derive for a month of the given length. Shown in the
 *  form so the number on the client's register is recognisable. */
function perDay(monthly: string | undefined, days: number): string {
  const m = parseFloat(monthly ?? "");
  return Number.isFinite(m) && m > 0 ? (m / days).toFixed(2) : "—";
}

export function RateCards() {
  const { selectedClientId } = useClientContext();
  const qc = useQueryClient();
  const [editing,   setEditing]   = useState<Partial<DailyRateCard> | null>(null);
  const [formError, setFormError] = useState("");

  const cards = useQuery({
    queryKey: ["rate-cards", selectedClientId],
    queryFn:  () => employeesApi.rateCards(),
    staleTime: STALE_STABLE,
  });

  const employees = useQuery({
    queryKey: ["employees", "all_active", selectedClientId],
    queryFn:  () => employeesApi.list({ page_size: 1000, status: "ACTIVE" }),
    staleTime: STALE_STABLE,
  });

  const assignedCount = (cardId: string) =>
    employees.data?.items.filter((e) => e.daily_rate_card_id === cardId).length ?? 0;

  const saveMut = useMutation({
    mutationFn: async (card: Partial<DailyRateCard>) => {
      if (!card.name?.trim()) throw new Error("Rate card name is required");
      const basic = parseFloat(card.monthly_basic ?? "");
      if (!Number.isFinite(basic) || basic <= 0) throw new Error("Monthly Basic must be greater than 0");
      const body = {
        name: card.name.trim(),
        monthly_basic: card.monthly_basic || "0",
        monthly_da:    card.monthly_da    || "0",
        monthly_hra:   card.monthly_hra   || "0",
        bonus_pct:   card.bonus_pct   || "0",
        is_active:   card.is_active ?? true,
      };
      return card.id
        ? employeesApi.updateRateCard(card.id, body)
        : employeesApi.createRateCard(body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["rate-cards"] });
      setEditing(null);
      setFormError("");
    },
    onError: (err) => setFormError(extractErrorMessage(err)),
  });

  function openNew() {
    setEditing({ ...BLANK });
    setFormError("");
  }

  const isLoading = cards.isLoading;
  const list      = cards.data ?? [];

  if (!selectedClientId) {
    return <NoClientSelected feature="rate cards" />;
  }

  return (
    <div className="space-y-6">
      {/* ── Page header ─────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-[26px] font-bold text-slate-900 dark:text-slate-50 leading-tight tracking-tight">
            Daily Rate Cards
          </h1>
          <p className="mt-1 text-[13px] text-slate-500 dark:text-slate-400">
            Monthly wages shared by this client's daily-rated employees — the day rate is derived per month
          </p>
        </div>

        <button onClick={openNew} className="btn shadow-[0_6px_20px_rgba(90,82,229,0.32)]">
          <Plus className="h-3.5 w-3.5" />
          New Rate Card
        </button>
      </div>

      {/* ── Data table ─────────────────────────────────────────────────── */}
      <div className="table-card overflow-x-auto">
        <div className="min-w-[820px]">
          <div className="flex items-center gap-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/40 px-6 py-3">
            <div className="flex-1 text-[10px] font-semibold uppercase tracking-[0.10em] text-slate-400 dark:text-slate-500">Name</div>
            {["Basic / month", "DA / month", "HRA / month", "Bonus %", "Total / month"].map((h) => (
              <div key={h} className="w-[92px] text-right text-[10px] font-semibold uppercase tracking-[0.10em] text-slate-400 dark:text-slate-500">
                {h}
              </div>
            ))}
            <div className="w-20 text-right text-[10px] font-semibold uppercase tracking-[0.10em] text-slate-400 dark:text-slate-500">Assigned</div>
            <div className="w-16" />
          </div>

          {isLoading && (
            <div className="divide-y divide-slate-50 dark:divide-slate-800/50">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4 px-6 py-4">
                  <Skeleton className="h-3.5 w-40 flex-1" />
                  {Array.from({ length: 6 }).map((_, j) => <Skeleton key={j} className="h-3.5 w-[72px]" />)}
                  <Skeleton className="h-3.5 w-10" />
                </div>
              ))}
            </div>
          )}

          {!isLoading && list.length === 0 && (
            <EmptyState
              title="No rate cards yet"
              description="Create a rate card with this client's monthly Basic, DA and HRA wages, then assign daily-wage employees to it."
              illustration="clipboard"
              action={
                <button onClick={openNew} className="btn shadow-[0_6px_20px_rgba(90,82,229,0.28)]">
                  <Plus className="h-3.5 w-3.5" />
                  New Rate Card
                </button>
              }
            />
          )}

          {!isLoading && list.length > 0 && (
            <div className="divide-y divide-slate-50 dark:divide-slate-800/40">
              {list.map((c, idx) => (
                <div
                  key={c.id}
                  className="row-in group flex items-center gap-4 px-6 py-3.5 transition-colors hover:bg-slate-50/60 dark:hover:bg-slate-800/25"
                >
                  <div className="flex flex-1 items-center gap-3 min-w-0">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-violet-50 dark:bg-violet-900/25">
                      <Coins className="h-4 w-4 text-violet-600 dark:text-violet-400" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-[13.5px] font-semibold text-slate-900 dark:text-slate-100 leading-tight truncate">
                        {c.name}
                      </div>
                      {!c.is_active && (
                        <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Inactive</div>
                      )}
                    </div>
                  </div>

                  {[c.monthly_basic, c.monthly_da, c.monthly_hra, c.bonus_pct].map((v, i) => (
                    <div key={i} className="w-[92px] text-right font-numeric text-[12.5px] text-slate-600 dark:text-slate-300 tabular-nums">
                      {i < 3 ? `₹${v}` : `${v}%`}
                    </div>
                  ))}
                  <div className="w-[92px] text-right font-numeric text-[12.5px] font-semibold text-slate-800 dark:text-slate-200 tabular-nums">
                    ₹{monthlyTotal(c).toFixed(2)}
                  </div>

                  <div className="w-20 flex items-center justify-end gap-1.5">
                    <Users className="h-3.5 w-3.5 text-slate-300 dark:text-slate-700 shrink-0" />
                    <span className="text-[13px] font-semibold text-slate-700 dark:text-slate-300 tabular-nums">
                      {assignedCount(c.id)}
                    </span>
                  </div>

                  <div className="w-16 flex justify-end">
                    <button
                      onClick={() => { setEditing(c); setFormError(""); }}
                      className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold text-slate-400 hover:text-[#3395FF] hover:bg-[#3395FF]/6 dark:hover:bg-[#3395FF]/10 transition-colors opacity-0 group-hover:opacity-100"
                    >
                      <Edit2 className="h-3 w-3" />
                      Edit
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Edit / Create modal ──────────────────────────────────────────── */}
      {editing && (
        <Modal
          open
          onClose={() => { setEditing(null); setFormError(""); }}
          title={editing.id ? "Edit Rate Card" : "New Rate Card"}
          size="md"
        >
          <div className="space-y-4">
            <div>
              <label className="label" htmlFor="rc-name">Name *</label>
              <input
                autoFocus
                id="rc-name"
                className="input"
                placeholder="e.g. Chakan Helper 2026"
                value={editing.name ?? ""}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              />
            </div>

            <div className="grid grid-cols-3 gap-3">
              {([
                ["monthly_basic", "Basic / month *", "9705"],
                ["monthly_da",    "DA / month",      "3375"],
                ["monthly_hra",   "HRA / month",     "654"],
              ] as const).map(([key, label, ph]) => (
                <div key={key}>
                  <label className="label" htmlFor={`rc-${key}`}>{label}</label>
                  <input
                    id={`rc-${key}`}
                    className="input"
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder={ph}
                    value={editing[key] ?? ""}
                    onChange={(e) => setEditing({ ...editing, [key]: e.target.value })}
                  />
                </div>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label" htmlFor="rc-bonus_pct">Bonus %</label>
                <input
                  id="rc-bonus_pct"
                  className="input"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="8.33"
                  value={editing.bonus_pct ?? ""}
                  onChange={(e) => setEditing({ ...editing, bonus_pct: e.target.value })}
                />
              </div>
            </div>

            <p className="text-[11.5px] text-slate-500 dark:text-slate-400">
              Enter <strong>monthly</strong> wages. Payroll derives the day rate for each cycle as
              monthly ÷ calendar days in that month — so ₹{editing.monthly_basic || "9705"} basic pays{" "}
              ₹{perDay(editing.monthly_basic, 31)}/day in a 31-day month and{" "}
              ₹{perDay(editing.monthly_basic, 30)}/day in a 30-day one, and a full month always pays
              exactly the monthly wage. Employees are paid their payable days (present + weekly offs +
              paid holidays) × that rate. Bonus is a percentage of earned Basic + DA; gross = Basic +
              DA + HRA + Bonus, with PF on gross minus HRA and ESI on gross minus bonus.
            </p>

            <label className="flex items-center gap-2 text-[12.5px] text-slate-600 dark:text-slate-300">
              <input
                type="checkbox"
                className="h-3.5 w-3.5 rounded border-slate-300"
                checked={editing.is_active ?? true}
                onChange={(e) => setEditing({ ...editing, is_active: e.target.checked })}
              />
              Active (inactive cards are hidden when assigning employees)
            </label>

            {formError && <div className="alert-danger text-sm">{formError}</div>}
          </div>
          <ModalFooter
            onClose={() => { setEditing(null); setFormError(""); }}
            onSave={() => saveMut.mutate(editing)}
            saving={saveMut.isPending}
            saveLabel={editing.id ? "Save Changes" : "Create Rate Card"}
          />
        </Modal>
      )}
    </div>
  );
}
