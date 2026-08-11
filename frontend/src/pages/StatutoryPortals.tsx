import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { clientsApi } from "../api/clients";
import { qk, STALE_STABLE } from "../lib/queryClient";
import { useClientContext } from "../lib/ClientContext";
import { PageHeader } from "../components/PageHeader";
import { EmptyState } from "../components/EmptyState";
import { FullPageSpinner } from "../components/Spinner";
import { ShieldPlus, Landmark, Receipt, HandCoins, ExternalLink, Copy, Check } from "lucide-react";
import clsx from "clsx";
import type { Client, StatutoryIds } from "../types";

/**
 * Government e-filing portals. The URLs are the same for every organization —
 * they are the national or state portals, not per-client tenants. What differs
 * per client is the registration identifier, which the cards surface for quick
 * copy.
 *
 * GST is deliberately absent: it is an indirect-tax filing on the company's
 * sales, not a payroll obligation, and nothing on this platform produces a GST
 * return. Professional Tax takes its place — that one IS deducted every cycle
 * (see compliance-service compute_pt) and has to be remitted monthly.
 */
interface Portal {
  key: "esi" | "pf" | "pt" | "lwf";
  name: string;
  fullName: string;
  description: string;
  url: string;
  icon: React.ElementType;
  accent: string;
  idLabel: string;
  /** Key inside the client's statutory_ids — the store of record. */
  idField: keyof StatutoryIds;
}

const PORTALS: Portal[] = [
  {
    key: "esi",
    name: "ESI",
    fullName: "Employees' State Insurance Corporation",
    description: "File monthly ESI contributions and manage insured persons on the ESIC employer portal.",
    url: "https://portal.esic.gov.in/EmployerPortal/ESICInsurancePortal/Portal_Loginnew.aspx",
    icon: ShieldPlus,
    accent: "emerald",
    idLabel: "ESIC Employer Code",
    idField: "esic_code",
  },
  {
    key: "pf",
    name: "PF",
    fullName: "EPFO Unified Employer Portal",
    description: "Upload ECR, generate challans and manage member details on the EPFO unified portal.",
    url: "https://unifiedportal-emp.epfindia.gov.in/epfo/",
    icon: Landmark,
    accent: "violet",
    idLabel: "PF Establishment Code",
    idField: "pf_code",
  },
  {
    key: "pt",
    name: "P.Tax",
    fullName: "Maharashtra Profession Tax (PTRC / PTEC)",
    description: "File monthly PTRC returns and pay the profession tax deducted from salaries on the MahaGST portal.",
    url: "https://www.mahagst.gov.in/en",
    icon: Receipt,
    accent: "amber",
    idLabel: "PTRC / PTEC Number",
    idField: "pt_number",
  },
  {
    key: "lwf",
    name: "MLWF",
    fullName: "Maharashtra Labour Welfare Board",
    description: "Pay the half-yearly Labour Welfare Fund contribution for the June and December periods.",
    url: "https://public.mlwb.in/",
    icon: HandCoins,
    accent: "sky",
    idLabel: "MLWF Establishment Code",
    idField: "lwf",
  },
];

const ACCENT: Record<string, { chip: string; icon: string; ring: string }> = {
  emerald: {
    chip: "bg-emerald-50 dark:bg-emerald-900/25 border-emerald-200 dark:border-emerald-800",
    icon: "text-emerald-600 dark:text-emerald-400",
    ring: "hover:border-emerald-400 dark:hover:border-emerald-600",
  },
  violet: {
    chip: "bg-violet-50 dark:bg-violet-900/25 border-violet-200 dark:border-violet-800",
    icon: "text-violet-600 dark:text-violet-400",
    ring: "hover:border-violet-400 dark:hover:border-violet-600",
  },
  amber: {
    chip: "bg-amber-50 dark:bg-amber-900/25 border-amber-200 dark:border-amber-800",
    icon: "text-amber-600 dark:text-amber-400",
    ring: "hover:border-amber-400 dark:hover:border-amber-600",
  },
  sky: {
    chip: "bg-sky-50 dark:bg-sky-900/25 border-sky-200 dark:border-sky-800",
    icon: "text-sky-600 dark:text-sky-400",
    ring: "hover:border-sky-400 dark:hover:border-sky-600",
  },
};

function CopyableId({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked (insecure origin / denied permission) — leave as-is */
    }
  }

  return (
    <button
      onClick={copy}
      title="Copy to clipboard"
      className="group inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white/60 dark:bg-slate-800/60 px-2 py-1 font-mono text-[11px] font-semibold text-slate-700 dark:text-slate-200 transition-colors hover:border-accent-400"
    >
      <span className="truncate max-w-[180px]">{value}</span>
      {copied ? (
        <Check className="h-3 w-3 shrink-0 text-emerald-500" />
      ) : (
        <Copy className="h-3 w-3 shrink-0 text-slate-400 group-hover:text-accent-500" />
      )}
    </button>
  );
}

function PortalCard({ portal, client }: { portal: Portal; client: Client | null }) {
  const accent = ACCENT[portal.accent];
  const regId = client?.statutory_ids?.[portal.idField] ?? null;

  return (
    <motion.a
      href={portal.url}
      target="_blank"
      rel="noopener noreferrer"
      whileHover={{ y: -3 }}
      transition={{ type: "spring", stiffness: 380, damping: 26 }}
      className={clsx(
        "card card-hover group flex flex-col gap-4 p-5 border transition-colors",
        "border-slate-200/70 dark:border-slate-700/70",
        accent.ring
      )}
    >
      <div className="flex items-start gap-3">
        <span className={clsx("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border", accent.chip)}>
          <portal.icon className={clsx("h-5 w-5", accent.icon)} strokeWidth={1.9} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <h3 className="text-[15px] font-bold text-slate-900 dark:text-slate-50">{portal.name}</h3>
            <ExternalLink className="h-3.5 w-3.5 text-slate-300 dark:text-slate-600 transition-colors group-hover:text-accent-500" />
          </div>
          <p className="mt-0.5 text-[11px] font-medium text-slate-400 dark:text-slate-500">
            {portal.fullName}
          </p>
        </div>
      </div>

      <p className="text-[12.5px] leading-relaxed text-slate-500 dark:text-slate-400">
        {portal.description}
      </p>

      <div className="mt-auto border-t border-slate-100 dark:border-slate-800 pt-3">
        <div className="text-[9px] font-semibold uppercase tracking-[0.14em] text-slate-400 dark:text-slate-500">
          {portal.idLabel}
        </div>
        <div className="mt-1.5" onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}>
          {!client ? (
            <span className="text-[11px] text-slate-400">Select a client to see its registration</span>
          ) : regId ? (
            <CopyableId value={regId} />
          ) : (
            <span className="text-[11px] text-slate-400">Not registered for {client.client_name}</span>
          )}
        </div>
      </div>
    </motion.a>
  );
}

export function StatutoryPortals() {
  const { selectedClientId } = useClientContext();

  const clientsQuery = useQuery({
    queryKey: qk.clients(),
    queryFn: () => clientsApi.list({ page_size: 200, status: "ACTIVE" }),
    staleTime: STALE_STABLE,
  });

  if (clientsQuery.isLoading) return <FullPageSpinner />;

  const clients = clientsQuery.data?.items ?? [];
  const client = clients.find((c) => c.id === selectedClientId) ?? null;

  return (
    <>
      <PageHeader
        title="Statutory Filings"
        subtitle={
          client
            ? `Government e-filing portals for ${client.client_name}`
            : "Government e-filing portals — pick an Active Client Account to see its registration numbers"
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {PORTALS.map((p) => (
          <PortalCard key={p.key} portal={p} client={client} />
        ))}
      </div>

      {clients.length === 0 && (
        <div className="mt-8">
          <EmptyState
            title="No active clients"
            description="Add a client with its ESI, PF, Profession Tax and MLWF registration details to see them here."
          />
        </div>
      )}
    </>
  );
}
