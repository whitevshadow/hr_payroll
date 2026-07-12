import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  Plus,
  Briefcase,
  MapPin,
  Phone,
  Shield,
  Eye,
  EyeOff,
  Edit2,
  Archive,
  Trash2,
  ChevronDown,
  ChevronUp,
  Building2,
  FileText,
  Lock,
  RefreshCw,
  Search,
  X,
  CheckCircle2,
  AlertTriangle,
  Users,
} from "lucide-react";
import { clientsApi } from "../api/clients";
import { qk, STALE_STABLE, STALE_OPERATIONAL } from "../lib/queryClient";
import { Modal, ModalFooter } from "../components/Modal";
import { EmptyState } from "../components/EmptyState";
import { ClientDocumentsPanel } from "../components/ClientDocumentsPanel";
import { Skeleton } from "../components/Spinner";
import { extractErrorMessage } from "../lib/toast";
import clsx from "clsx";
import type { Client, ClientCredential } from "../types";

// ── Animation variants ───────────────────────────────────────────────────────
const ROW_ANIM = {
  hidden: { opacity: 0, y: 8 },
  show: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.04, duration: 0.22 },
  }),
};

const SECTION_COLORS = [
  "bg-violet-50 dark:bg-violet-900/25 text-violet-600 dark:text-violet-400",
  "bg-blue-50 dark:bg-blue-900/25 text-blue-600 dark:text-blue-400",
  "bg-emerald-50 dark:bg-emerald-900/25 text-emerald-600 dark:text-emerald-400",
  "bg-amber-50 dark:bg-amber-900/25 text-amber-600 dark:text-amber-400",
  "bg-pink-50 dark:bg-pink-900/25 text-pink-600 dark:text-pink-400",
  "bg-teal-50 dark:bg-teal-900/25 text-teal-600 dark:text-teal-400",
];

type PortalType = "PF" | "ESIC" | "GST";
const PORTAL_LABELS: Record<PortalType, string> = {
  PF: "PF Portal",
  ESIC: "ESIC Portal",
  GST: "GST Portal",
};

// ── Empty client form ────────────────────────────────────────────────────────
function emptyClient(): Partial<Client> & {
  _pfUser?: string; _pfPass?: string;
  _esicUser?: string; _esicPass?: string;
  _gstUser?: string; _gstPass?: string;
} {
  return {
    client_code: "", client_name: "", legal_name: "",
    address_line1: "", address_line2: "", area: "", city: "", state: "", country: "India", pincode: "",
    gst_number: "", pan_number: "", tan_number: "", cin_number: "",
    contact_person: "", contact_email: "", contact_mobile: "", contact_telephone: "",
    pf_establishment_code: "", esic_employer_code: "", professional_tax_number: "", labour_license_number: "", shop_act_number: "",
    _pfUser: "", _pfPass: "", _esicUser: "", _esicPass: "", _gstUser: "", _gstPass: "",
  };
}

// ── Section accordion ────────────────────────────────────────────────────────
function Section({ title, icon: Icon, children, defaultOpen = false }: {
  title: string; icon: React.ElementType; children: React.ReactNode; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-slate-100 dark:border-slate-800 rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2.5 px-4 py-3 bg-slate-50/60 dark:bg-slate-800/40 hover:bg-slate-100/60 dark:hover:bg-slate-700/30 transition-colors"
      >
        <Icon className="h-4 w-4 text-slate-400 shrink-0" />
        <span className="flex-1 text-left text-[13px] font-semibold text-slate-700 dark:text-slate-300">{title}</span>
        {open ? <ChevronUp className="h-3.5 w-3.5 text-slate-400" /> : <ChevronDown className="h-3.5 w-3.5 text-slate-400" />}
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="px-4 py-4 space-y-3">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function FormRow({ label, children, required }: { label: string; children: React.ReactNode; required?: boolean }) {
  return (
    <div>
      <label className="label">{label}{required && <span className="text-danger ml-0.5">*</span>}</label>
      {children}
    </div>
  );
}

function PasswordField({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input
        type={show ? "text" : "password"}
        className="input pr-10"
        placeholder={placeholder ?? "Enter password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
      >
        {show ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}

// ── Credential reveal mini-panel ─────────────────────────────────────────────
function CredentialRevealPanel({ clientId, cred, onClose }: {
  clientId: string; cred: ClientCredential; onClose: () => void;
}) {
  const [revealed, setRevealed] = useState<{ username: string | null; password: string | null } | null>(null);
  const [showPass, setShowPass] = useState(false);
  const [countdown, setCountdown] = useState(30);

  const revealMut = useMutation({
    mutationFn: () => clientsApi.revealCredential(clientId, cred.id),
    onSuccess: (data) => {
      setRevealed({ username: data.username, password: data.password });
      setShowPass(true);
    },
  });

  useEffect(() => {
    if (!revealed) return;
    const t = setInterval(() => setCountdown((c) => c - 1), 1000);
    return () => clearInterval(t);
  }, [revealed]);

  useEffect(() => {
    if (countdown <= 0 && revealed) { setShowPass(false); onClose(); }
  }, [countdown, revealed, onClose]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Lock className="h-4 w-4 text-amber-500" />
        <span className="text-[13px] font-semibold text-slate-800 dark:text-slate-200">
          {PORTAL_LABELS[cred.portal_type as PortalType]} Credentials
        </span>
      </div>
      {!revealed ? (
        <div className="space-y-2">
          <p className="text-[12px] text-slate-500">
            Viewing credentials will be logged in the Audit Log.
          </p>
          <button
            className="btn btn-sm"
            onClick={() => revealMut.mutate()}
            disabled={revealMut.isPending}
          >
            {revealMut.isPending ? "Decrypting…" : "Reveal Credentials"}
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-amber-600 dark:text-amber-400 font-semibold">
              Auto-hides in {countdown}s
            </span>
            <button onClick={() => { setShowPass(false); onClose(); }} className="text-slate-400 hover:text-slate-600">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="rounded-lg bg-slate-50 dark:bg-slate-800/60 p-3 space-y-2 font-mono text-[12px]">
            <div><span className="text-slate-400">Username:</span> <span className="text-slate-900 dark:text-slate-100 ml-2">{revealed.username ?? "—"}</span></div>
            <div className="flex items-center gap-2">
              <span className="text-slate-400">Password:</span>
              <span className="text-slate-900 dark:text-slate-100 ml-2">
                {showPass ? (revealed.password ?? "—") : "••••••••••••"}
              </span>
              <button onClick={() => setShowPass((s) => !s)} className="text-slate-400 hover:text-slate-600 ml-1">
                {showPass ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Client form modal ────────────────────────────────────────────────────────
function ClientModal({ client, onClose }: {
  client: ReturnType<typeof emptyClient> & { id?: string };
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState<ReturnType<typeof emptyClient>>(client);
  const [formError, setFormError] = useState("");
  const isEdit = !!client.id;

  const F = <K extends keyof typeof form>(key: K) => ({
    value: (form[key] as string) ?? "",
    onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((f) => ({ ...f, [key]: e.target.value })),
  });

  const saveMut = useMutation({
    mutationFn: async () => {
      if (!form.client_name?.trim()) throw new Error("Client Name is required");

      const payload = {
        client_code: form.client_code || undefined,
        client_name: form.client_name!,
        legal_name: form.legal_name || undefined,
        address_line1: form.address_line1 || undefined,
        address_line2: form.address_line2 || undefined,
        area: form.area || undefined,
        city: form.city || undefined,
        state: form.state || undefined,
        country: form.country ?? "India",
        pincode: form.pincode || undefined,
        gst_number: form.gst_number || undefined,
        pan_number: form.pan_number || undefined,
        tan_number: form.tan_number || undefined,
        cin_number: form.cin_number || undefined,
        contact_person: form.contact_person || undefined,
        contact_email: form.contact_email || undefined,
        contact_mobile: form.contact_mobile || undefined,
        contact_telephone: form.contact_telephone || undefined,
        pf_establishment_code: form.pf_establishment_code || undefined,
        esic_employer_code: form.esic_employer_code || undefined,
        professional_tax_number: form.professional_tax_number || undefined,
        labour_license_number: form.labour_license_number || undefined,
        shop_act_number: form.shop_act_number || undefined,
      };

      const saved = isEdit
        ? await clientsApi.update(client.id!, payload)
        : await clientsApi.create(payload as any);

      // Save credentials if provided
      const credUpdates: Array<{ type: "PF" | "ESIC" | "GST"; user?: string; pass?: string }> = [
        { type: "PF", user: form._pfUser, pass: form._pfPass },
        { type: "ESIC", user: form._esicUser, pass: form._esicPass },
        { type: "GST", user: form._gstUser, pass: form._gstPass },
      ];
      for (const c of credUpdates) {
        if (c.user || c.pass) {
          await clientsApi.upsertCredential(saved.id, {
            portal_type: c.type,
            portal_name: PORTAL_LABELS[c.type],
            username: c.user,
            password: c.pass,
          });
        }
      }
      return saved;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["clients"] });
      onClose();
    },
    onError: (err) => setFormError(extractErrorMessage(err)),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={isEdit ? "Edit Client" : "Add Client"}
      size="lg"
    >
      <div className="space-y-3 max-h-[70vh] overflow-y-auto pr-1">
        {/* Basic */}
        <Section title="Basic Information" icon={Building2} defaultOpen>
          <div className="grid grid-cols-2 gap-3">
            <FormRow label="Client Name" required>
              <input className="input" placeholder="e.g. Nibe Limited" {...F("client_name")} />
            </FormRow>
            <FormRow label="Legal Company Name">
              <input className="input" placeholder="e.g. Nibe Ltd." {...F("legal_name")} />
            </FormRow>
          </div>
        </Section>

        {/* Address */}
        <Section title="Address Information" icon={MapPin}>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <FormRow label="Address Line 1">
                <input className="input" placeholder="Street / Building" {...F("address_line1")} />
              </FormRow>
            </div>
            <FormRow label="Address Line 2">
              <input className="input" placeholder="Floor / Suite" {...F("address_line2")} />
            </FormRow>
            <FormRow label="Area">
              <input className="input" placeholder="Area / Locality" {...F("area")} />
            </FormRow>
            <FormRow label="City" required>
              <input className="input" placeholder="e.g. Pune" {...F("city")} />
            </FormRow>
            <FormRow label="State" required>
              <input className="input" placeholder="e.g. Maharashtra" {...F("state")} />
            </FormRow>
            <FormRow label="Country">
              <input className="input" placeholder="India" {...F("country")} />
            </FormRow>
            <FormRow label="Pincode" required>
              <input className="input" placeholder="e.g. 411001" {...F("pincode")} />
            </FormRow>
          </div>
        </Section>

        {/* Tax */}
        <Section title="Tax Information" icon={FileText}>
          <div className="grid grid-cols-2 gap-3">
            <FormRow label="GST Number">
              <input className="input" placeholder="27XXXXX…" {...F("gst_number")} />
            </FormRow>
            <FormRow label="PAN Number">
              <input className="input" placeholder="XXXXX0000X" {...F("pan_number")} />
            </FormRow>
            <FormRow label="TAN Number">
              <input className="input" placeholder="XXXX00000X" {...F("tan_number")} />
            </FormRow>
            <FormRow label="CIN Number">
              <input className="input" placeholder="U12345XX0000XXX…" {...F("cin_number")} />
            </FormRow>
          </div>
        </Section>

        {/* Contact */}
        <Section title="Contact Information" icon={Phone}>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <FormRow label="Contact Person">
                <input className="input" placeholder="e.g. Rahul Sharma" {...F("contact_person")} />
              </FormRow>
            </div>
            <FormRow label="Email">
              <input className="input" type="email" placeholder="hr@client.com" {...F("contact_email")} />
            </FormRow>
            <FormRow label="Mobile">
              <input className="input" placeholder="9876543210" {...F("contact_mobile")} />
            </FormRow>
            <FormRow label="Telephone">
              <input className="input" placeholder="020-12345678" {...F("contact_telephone")} />
            </FormRow>
          </div>
        </Section>

        {/* Statutory */}
        <Section title="Statutory Registrations" icon={Shield}>
          <div className="grid grid-cols-2 gap-3">
            <FormRow label="PF Establishment Code">
              <input className="input" placeholder="MHBAN…" {...F("pf_establishment_code")} />
            </FormRow>
            <FormRow label="ESIC Employer Code">
              <input className="input" placeholder="31000…" {...F("esic_employer_code")} />
            </FormRow>
            <FormRow label="Professional Tax Number">
              <input className="input" placeholder="PT/…" {...F("professional_tax_number")} />
            </FormRow>
            <FormRow label="Labour License Number">
              <input className="input" placeholder="LL/…" {...F("labour_license_number")} />
            </FormRow>
            <div className="col-span-2">
              <FormRow label="Shop Act Number">
                <input className="input" placeholder="SA/…" {...F("shop_act_number")} />
              </FormRow>
            </div>
          </div>
        </Section>

        {/* Credentials */}
        <Section title="Portal Credentials (Encrypted at Rest)" icon={Lock}>
          <div className="rounded-lg bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800/40 px-3 py-2 text-[11.5px] text-amber-700 dark:text-amber-400 mb-3">
            🔒 Passwords are encrypted using AES-256 before storage. They are never displayed in plain text.
          </div>
          {(["PF", "ESIC", "GST"] as const).map((type) => {
            const userKey = `_${type.toLowerCase()}User` as keyof typeof form;
            const passKey = `_${type.toLowerCase()}Pass` as keyof typeof form;
            return (
              <div key={type} className="border border-slate-100 dark:border-slate-800 rounded-lg p-3 space-y-2">
                <div className="text-[12px] font-semibold text-slate-600 dark:text-slate-400">{PORTAL_LABELS[type]}</div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="label text-[10.5px]">Username</label>
                    <input
                      className="input"
                      placeholder={`${type} portal username`}
                      value={(form[userKey] as string) ?? ""}
                      onChange={(e) => setForm((f) => ({ ...f, [userKey]: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="label text-[10.5px]">Password</label>
                    <PasswordField
                      value={(form[passKey] as string) ?? ""}
                      onChange={(v) => setForm((f) => ({ ...f, [passKey]: v }))}
                      placeholder={`${type} portal password`}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </Section>
      </div>

      {formError && (
        <div className="alert-danger text-sm mt-3">{formError}</div>
      )}

      <ModalFooter
        onClose={onClose}
        onSave={() => saveMut.mutate()}
        saving={saveMut.isPending}
        saveLabel={isEdit ? "Save Changes" : "Add Client"}
      />
    </Modal>
  );
}

// ── Client credentials panel inside the detail view ──────────────────────────
function ClientCredentialsPanel({ client }: { client: Client }) {
  const qc = useQueryClient();
  const [revealingId, setRevealingId] = useState<string | null>(null);

  const credsQ = useQuery({
    queryKey: qk.clientCredentials(client.id),
    queryFn: () => clientsApi.listCredentials(client.id),
    staleTime: STALE_STABLE,
  });

  const creds = credsQ.data ?? [];

  return (
    <div className="space-y-2">
      {creds.length === 0 && (
        <div className="text-[12px] text-slate-400 text-center py-4">No portal credentials stored yet.</div>
      )}
      {creds.map((cred) => (
        <div key={cred.id} className="border border-slate-100 dark:border-slate-800 rounded-xl p-3">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Lock className="h-3.5 w-3.5 text-slate-400" />
              <span className="text-[12.5px] font-semibold text-slate-700 dark:text-slate-300">
                {PORTAL_LABELS[cred.portal_type as PortalType] ?? cred.portal_type}
              </span>
              {cred.has_password && (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 dark:bg-emerald-900/20 px-2 py-0.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="h-2.5 w-2.5" /> Encrypted
                </span>
              )}
            </div>
            {cred.has_password && (
              <button
                onClick={() => setRevealingId(revealingId === cred.id ? null : cred.id)}
                className="flex items-center gap-1 text-[11px] font-semibold text-[#5A52E5] hover:text-[#4841CC] dark:text-violet-400 transition-colors"
              >
                <Eye className="h-3 w-3" />
                {revealingId === cred.id ? "Hide" : "Reveal"}
              </button>
            )}
          </div>
          <div className="text-[11.5px] text-slate-500">
            Username: <span className="font-mono text-slate-700 dark:text-slate-300">{cred.username ?? "—"}</span>
          </div>
          <AnimatePresence>
            {revealingId === cred.id && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.18 }}
                className="mt-2 overflow-hidden"
              >
                <CredentialRevealPanel
                  clientId={client.id}
                  cred={cred}
                  onClose={() => setRevealingId(null)}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      ))}
    </div>
  );
}

// ── Status badge ─────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    ACTIVE: "bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400",
    INACTIVE: "bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400",
    ARCHIVED: "bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400",
  };
  return (
    <span className={clsx("inline-flex items-center rounded-full px-2.5 py-0.5 text-[10.5px] font-semibold", styles[status] ?? styles.INACTIVE)}>
      {status}
    </span>
  );
}

// ── Main Clients page ────────────────────────────────────────────────────────
export function Clients() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [editing, setEditing] = useState<(ReturnType<typeof emptyClient> & { id?: string }) | null>(null);
  const [detailClient, setDetailClient] = useState<Client | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const [confirmArchive, setConfirmArchive] = useState<Client | null>(null);
  const [activeTab, setActiveTab] = useState<"details" | "credentials" | "documents">("details");

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const clientsQ = useQuery({
    queryKey: qk.clients({ search: debouncedSearch }),
    queryFn: () => clientsApi.list({ search: debouncedSearch || undefined, page_size: 100 }),
    staleTime: STALE_OPERATIONAL,
  });

  const archiveMut = useMutation({
    mutationFn: (id: string) => clientsApi.archive(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["clients"] });
      setConfirmArchive(null);
    },
    onError: (err) => setDeleteError(extractErrorMessage(err)),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => clientsApi.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["clients"] });
      setConfirmArchive(null);
    },
    onError: (err) => setDeleteError(extractErrorMessage(err)),
  });

  const clients = clientsQ.data?.items ?? [];
  const total = clientsQ.data?.total ?? 0;
  const activeCount = clients.filter((c) => c.status === "ACTIVE").length;

  return (
    <div className="space-y-6">
      {/* ── Page header ─────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-[26px] font-bold text-slate-900 dark:text-slate-50 leading-tight tracking-tight">
            Clients
          </h1>
          <p className="mt-1 text-[13px] text-slate-500 dark:text-slate-400">
            Manage client companies and portal credentials
          </p>
        </div>
        <button
          onClick={() => setEditing(emptyClient())}
          className="btn shadow-[0_6px_20px_rgba(90,82,229,0.32)]"
        >
          <Plus className="h-3.5 w-3.5" />
          Add Client
        </button>
      </div>

      {/* ── KPI strip ───────────────────────────────────────────────────── */}
      {!clientsQ.isLoading && clients.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {[
            { label: "Total Clients", value: total },
            { label: "Active", value: activeCount },
            { label: "Archived", value: total - activeCount },
          ].map((kpi, i) => (
            <motion.div
              key={kpi.label}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.06 }}
              className="card p-4"
            >
              <div className="kpi-label">{kpi.label}</div>
              <div className="kpi-value mt-1">{kpi.value}</div>
            </motion.div>
          ))}
        </div>
      )}

      {/* ── Search + table ──────────────────────────────────────────────── */}
      <div className="table-card overflow-hidden">
        {/* Search bar */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100 dark:border-slate-800">
          <Search className="h-3.5 w-3.5 text-slate-400 shrink-0" />
          <input
            className="flex-1 bg-transparent text-[13px] text-slate-700 dark:text-slate-200 placeholder-slate-400 outline-none"
            placeholder="Search clients by name, code, or city…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button onClick={() => setSearch("")} className="text-slate-300 hover:text-slate-500">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* Column headers */}
        <div className="hidden sm:flex items-center gap-4 px-6 py-2.5 border-b border-slate-100 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40">
          <div className="flex-1 text-[10px] font-semibold uppercase tracking-[0.10em] text-slate-400">Client</div>
          <div className="w-28 text-[10px] font-semibold uppercase tracking-[0.10em] text-slate-400">Code</div>
          <div className="w-36 text-[10px] font-semibold uppercase tracking-[0.10em] text-slate-400">Location</div>
          <div className="w-24 text-[10px] font-semibold uppercase tracking-[0.10em] text-slate-400">Status</div>
          <div className="w-20 text-[10px] font-semibold uppercase tracking-[0.10em] text-slate-400 text-right">Actions</div>
        </div>

        {/* Skeleton */}
        {clientsQ.isLoading && (
          <div className="divide-y divide-slate-50 dark:divide-slate-800/50">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-6 py-4">
                <div className="flex-1 flex items-center gap-3">
                  <Skeleton className="h-9 w-9 rounded-xl" />
                  <div className="space-y-1.5">
                    <Skeleton className="h-3.5 w-40" />
                    <Skeleton className="h-3 w-24" />
                  </div>
                </div>
                <Skeleton className="hidden sm:block h-3.5 w-16" />
                <Skeleton className="hidden sm:block h-3.5 w-24" />
                <Skeleton className="h-5 w-14 rounded-full" />
              </div>
            ))}
          </div>
        )}

        {/* Empty state */}
        {!clientsQ.isLoading && clients.length === 0 && (
          <EmptyState
            title="No clients yet"
            description="Add your first client company to start mapping employees."
            illustration="clipboard"
            action={
              <button onClick={() => setEditing(emptyClient())} className="btn">
                <Plus className="h-3.5 w-3.5" /> Add Client
              </button>
            }
          />
        )}

        {/* Rows */}
        {!clientsQ.isLoading && clients.length > 0 && (
          <div className="divide-y divide-slate-50 dark:divide-slate-800/40">
            {clients.map((client, idx) => {
              const colorClass = SECTION_COLORS[idx % SECTION_COLORS.length];
              return (
                <motion.div
                  key={client.id}
                  custom={idx}
                  variants={ROW_ANIM}
                  initial="hidden"
                  animate="show"
                  className="group flex items-center gap-4 px-6 py-3.5 hover:bg-slate-50/60 dark:hover:bg-slate-800/25 transition-colors cursor-pointer"
                  onClick={() => { setDetailClient(client); setActiveTab("details"); }}
                >
                  {/* Icon + name */}
                  <div className="flex flex-1 items-center gap-3 min-w-0">
                    <div className={clsx("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl", colorClass)}>
                      <Briefcase className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-[13.5px] font-semibold text-slate-900 dark:text-slate-100 leading-tight truncate">
                        {client.client_name}
                      </div>
                      {client.legal_name && (
                        <div className="text-[11px] text-slate-400 truncate">{client.legal_name}</div>
                      )}
                    </div>
                  </div>

                  {/* Code */}
                  <div className="hidden sm:block w-28">
                    <span className="font-mono text-[11.5px] text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 rounded-md px-2 py-0.5">
                      {client.client_code}
                    </span>
                  </div>

                  {/* Location */}
                  <div className="hidden sm:flex w-36 items-center gap-1 text-[12px] text-slate-500 dark:text-slate-400">
                    {(client.city || client.state) && (
                      <>
                        <MapPin className="h-3 w-3 shrink-0 text-slate-300 dark:text-slate-600" />
                        <span className="truncate">{[client.city, client.state].filter(Boolean).join(", ")}</span>
                      </>
                    )}
                  </div>

                  {/* Status */}
                  <div className="w-24"><StatusBadge status={client.status} /></div>

                  {/* Actions */}
                  <div
                    className="w-20 flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      title="Edit"
                      onClick={() => setEditing({ ...client })}
                      className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:text-[#5A52E5] hover:bg-[#5A52E5]/8 transition-colors"
                    >
                      <Edit2 className="h-3.5 w-3.5" />
                    </button>
                    <button
                      title="Archive"
                      onClick={() => { setConfirmArchive(client); setDeleteError(""); }}
                      className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-colors"
                    >
                      <Archive className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Add/Edit modal ──────────────────────────────────────────────── */}
      {editing && (
        <ClientModal client={editing} onClose={() => setEditing(null)} />
      )}

      {/* ── Client detail drawer ─────────────────────────────────────────── */}
      <AnimatePresence>
        {detailClient && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/30 dark:bg-black/50 z-40"
              onClick={() => setDetailClient(null)}
            />
            <motion.div
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", damping: 28, stiffness: 260 }}
              className="fixed right-0 top-0 h-full w-full max-w-md bg-white dark:bg-slate-900 shadow-2xl z-50 flex flex-col overflow-hidden"
            >
              {/* Drawer header */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-800">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-50 dark:bg-violet-900/25 text-violet-600 dark:text-violet-400">
                    <Briefcase className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="text-[14px] font-bold text-slate-900 dark:text-slate-100">{detailClient.client_name}</div>
                    <div className="text-[11px] text-slate-400 font-mono">{detailClient.client_code}</div>
                  </div>
                </div>
                <button
                  onClick={() => setDetailClient(null)}
                  className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Tabs */}
              <div className="flex items-center gap-6 px-5 border-b border-slate-100 dark:border-slate-800 shrink-0">
                {(["details", "credentials", "documents"] as const).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={clsx(
                      "py-3 text-[13px] font-semibold transition-colors relative",
                      activeTab === tab
                        ? "text-accent-600 dark:text-accent-400"
                        : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300"
                    )}
                  >
                    {tab.charAt(0).toUpperCase() + tab.slice(1)}
                    {activeTab === tab && (
                      <motion.div
                        layoutId="client-drawer-tab"
                        className="absolute bottom-0 left-0 right-0 h-[2px] bg-accent-600 dark:bg-accent-400"
                      />
                    )}
                  </button>
                ))}
              </div>

              {/* Drawer body */}
              <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
                {activeTab === "details" && (
                  <div className="space-y-5">
                    {/* Status */}
                    <div className="flex items-center gap-2">
                      <StatusBadge status={detailClient.status} />
                      {detailClient.city && (
                        <span className="text-[12px] text-slate-400">
                          <MapPin className="inline h-3 w-3 mr-0.5" />
                          {[detailClient.city, detailClient.state].filter(Boolean).join(", ")}
                        </span>
                      )}
                    </div>

                    {/* Address */}
                    {(detailClient.address_line1 || detailClient.pincode) && (
                      <div>
                        <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5">Address</div>
                        <div className="text-[12.5px] text-slate-600 dark:text-slate-400 space-y-0.5">
                          {[detailClient.address_line1, detailClient.address_line2, detailClient.area, `${detailClient.city ?? ""} ${detailClient.pincode ?? ""}`.trim()].filter(Boolean).map((l, i) => (
                            <div key={i}>{l}</div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Tax */}
                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-2">Tax Details</div>
                      <div className="grid grid-cols-2 gap-2">
                        {[
                          ["GST", detailClient.gst_number],
                          ["PAN", detailClient.pan_number],
                          ["TAN", detailClient.tan_number],
                          ["CIN", detailClient.cin_number],
                        ].map(([label, val]) =>
                          val ? (
                            <div key={label} className="bg-slate-50 dark:bg-slate-800/60 rounded-lg px-3 py-2">
                              <div className="text-[9.5px] font-semibold uppercase tracking-wider text-slate-400">{label}</div>
                              <div className="text-[12px] font-mono text-slate-700 dark:text-slate-300 mt-0.5">{val}</div>
                            </div>
                          ) : null
                        )}
                      </div>
                    </div>

                    {/* Contact */}
                    {detailClient.contact_person && (
                      <div>
                        <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5">Contact</div>
                        <div className="text-[12.5px] text-slate-600 dark:text-slate-400">
                          <div className="font-medium text-slate-800 dark:text-slate-200">{detailClient.contact_person}</div>
                          {detailClient.contact_email && <div>{detailClient.contact_email}</div>}
                          {detailClient.contact_mobile && <div>{detailClient.contact_mobile}</div>}
                        </div>
                      </div>
                    )}

                    {/* Statutory */}
                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-2">Statutory Registrations</div>
                      <div className="space-y-1">
                        {[
                          ["PF Code", detailClient.pf_establishment_code],
                          ["ESIC Code", detailClient.esic_employer_code],
                          ["PT No.", detailClient.professional_tax_number],
                          ["Labour Lic.", detailClient.labour_license_number],
                          ["Shop Act", detailClient.shop_act_number],
                        ].map(([label, val]) =>
                          val ? (
                            <div key={label} className="flex items-center justify-between text-[12px]">
                              <span className="text-slate-400">{label}</span>
                              <span className="font-mono text-slate-700 dark:text-slate-300">{val}</span>
                            </div>
                          ) : null
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {activeTab === "credentials" && (
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-2">Portal Credentials</div>
                    <ClientCredentialsPanel client={detailClient} />
                  </div>
                )}

                {activeTab === "documents" && (
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-2">Documents</div>
                    <ClientDocumentsPanel client={detailClient} />
                  </div>
                )}
              </div>

              {/* Drawer footer */}
              <div className="shrink-0 flex items-center gap-2 px-5 py-3 border-t border-slate-100 dark:border-slate-800">
                <button
                  onClick={() => { setEditing({ ...detailClient }); setDetailClient(null); }}
                  className="btn flex-1"
                >
                  <Edit2 className="h-3.5 w-3.5" /> Edit Client
                </button>
                <button
                  onClick={() => { setConfirmArchive(detailClient); setDetailClient(null); setDeleteError(""); }}
                  className="btn-outline flex items-center gap-1.5 px-3 py-1.5 text-[12.5px] font-semibold text-amber-600 border-amber-200 dark:border-amber-800 hover:bg-amber-50 dark:hover:bg-amber-900/20 rounded-xl transition-colors"
                >
                  <Archive className="h-3.5 w-3.5" /> Archive
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* ── Archive confirm modal ─────────────────────────────────────────── */}
      {confirmArchive && (
        <Modal
          open
          onClose={() => setConfirmArchive(null)}
          title="Archive Client"
          size="sm"
        >
          <div className="space-y-3">
            <div className="flex items-start gap-3 rounded-xl bg-amber-50 dark:bg-amber-900/15 border border-amber-200 dark:border-amber-800/40 p-3">
              <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
              <div className="text-[12.5px] text-amber-700 dark:text-amber-300">
                <strong>{confirmArchive.client_name}</strong> will be archived. Existing employee links are preserved.
                Archived clients cannot be assigned to new employees.
              </div>
            </div>
            {deleteError && (
              <div className="alert-danger text-sm whitespace-pre-wrap">{deleteError}</div>
            )}
          </div>
          <ModalFooter
            onClose={() => setConfirmArchive(null)}
            onSave={() => archiveMut.mutate(confirmArchive.id)}
            saving={archiveMut.isPending}
            saveLabel="Archive Client"
          />
        </Modal>
      )}
    </div>
  );
}
