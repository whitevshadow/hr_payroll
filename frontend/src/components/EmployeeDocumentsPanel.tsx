/**
 * EmployeeDocumentsPanel
 *
 * Production-grade document management UI.
 * All document metadata (category, label, verification status) is sourced
 * exclusively from the API. No logic derives meaning from MinIO object paths.
 *
 * Features
 * --------
 * - Drag-and-drop upload (HTML5, no deps)
 * - Preview modal (streams bytes from API — MinIO never exposed)
 * - Verify / Reject / Delete — HR admin roles only
 * - KYC completion ring + required-document checklist
 * - Version history toggle
 * - Real-time refresh after every mutation
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  Upload,
  CheckCircle2,
  XCircle,
  Eye,
  Trash2,
  FileText,
  X,
  AlertTriangle,
  Clock,
  History,
  ChevronDown,
  ChevronUp,
  Download,
} from "lucide-react";
import clsx from "clsx";
import api from "../lib/api";
import { qk, STALE_STABLE } from "../lib/queryClient";
import { useAuth } from "../lib/auth";
import { hasRole } from "../lib/roles";
import { toastService, extractErrorMessage } from "../lib/toast";
import { Spinner } from "./Spinner";

// ── Types ────────────────────────────────────────────────────────────────────

interface DocOut {
  id: string;
  tenant_id: string;
  employee_id: string;
  filename: string;
  mime_type: string;
  file_size: number;
  doc_category: string;
  doc_label: string;
  description: string | null;
  verification_status: "PENDING" | "VERIFIED" | "REJECTED" | string;
  rejection_reason: string | null;
  uploaded_by: string;
  uploaded_at: string;
  verified_by: string | null;
  verified_at: string | null;
  deleted_at: string | null;
  superseded_by_id: string | null;
}

interface CategoryGroup {
  category: string;
  label: string;
  icon: string;
  documents: DocOut[];
  count: number;
}

interface DocListResponse {
  employee_id: string;
  categories: CategoryGroup[];
  total: number;
}

interface MissingDocItem {
  doc_category: string;
  doc_label: string;
  required: boolean;
  present: boolean;
  blob_id: string | null;
  verification_status: string | null;
}

interface CompletionResponse {
  employee_id: string;
  items: MissingDocItem[];
  completion_pct: number;
  is_activation_ready: boolean;
}

interface DocStats {
  total: number;
  pending: number;
  verified: number;
  rejected: number;
  storage_bytes: number;
}

// ── Constants ─────────────────────────────────────────────────────────────────
// Values must exactly match DocCategory and DocLabel in the backend model.

const DOC_CATEGORIES = [
  { value: "identity",   label: "Identity",   icon: "🪪" },
  { value: "banking",    label: "Banking",    icon: "🏦" },
  { value: "employment", label: "Employment", icon: "💼" },
  { value: "compliance", label: "Compliance", icon: "📋" },
  { value: "payroll",    label: "Payroll",    icon: "💰" },
  { value: "custom",     label: "Custom",     icon: "📁" },
] as const;

const LABELS_BY_CATEGORY: Record<string, string[]> = {
  identity:   ["AADHAAR_CARD", "PAN_CARD", "PHOTO"],
  banking:    ["CANCELLED_CHEQUE"],
  employment: ["OFFER_LETTER", "APPOINTMENT_LETTER"],
  compliance: ["FORM16", "OTHER"],
  payroll:    ["SALARY_REVISION", "FORM16", "OTHER"],
  custom:     ["OTHER"],
};

const ALLOWED_EXTENSIONS = ".pdf,.jpg,.jpeg,.png,.webp,.gif,.doc,.docx,.txt";

// ── Utilities ─────────────────────────────────────────────────────────────────

function formatBytes(b: number) {
  if (!b || b <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let v = b, u = 0;
  while (v >= 1024 && u < units.length - 1) { v /= 1024; u++; }
  return `${v.toFixed(v >= 10 || u === 0 ? 0 : 1)} ${units[u]}`;
}

function humanize(s: string) { return s.replace(/_/g, " "); }

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric", month: "short", year: "numeric",
  });
}

function statusChip(status: string | null) {
  switch ((status ?? "PENDING").toUpperCase()) {
    case "VERIFIED":
      return "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400";
    case "REJECTED":
      return "bg-rose-50 text-rose-700 dark:bg-rose-900/20 dark:text-rose-400";
    default:
      return "bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400";
  }
}

function StatusIcon({ status }: { status: string | null }) {
  switch ((status ?? "PENDING").toUpperCase()) {
    case "VERIFIED": return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />;
    case "REJECTED": return <XCircle className="h-3.5 w-3.5 text-rose-500" />;
    default:         return <Clock className="h-3.5 w-3.5 text-amber-500" />;
  }
}

// ── API client ────────────────────────────────────────────────────────────────

const empDocApi = {
  list: (employeeId: string) =>
    api.get<DocListResponse>(`/employee-docs/${employeeId}`).then(r => r.data),

  missing: (employeeId: string) =>
    api.get<CompletionResponse>(`/employee-docs/${employeeId}/missing`).then(r => r.data),

  stats: (employeeId: string) =>
    api.get<DocStats>(`/employee-docs/${employeeId}/stats`).then(r => r.data),

  history: (employeeId: string) =>
    api.get<DocOut[]>(`/employee-docs/${employeeId}/history`).then(r => r.data),

  upload: (employeeId: string, form: FormData) =>
    api.post<DocOut>(`/employee-docs/${employeeId}/upload`, form, {
      headers: { "Content-Type": "multipart/form-file" },
    }).then(r => r.data),

  verify: (employeeId: string, blobId: string, comment?: string) =>
    api.post<DocOut>(`/employee-docs/${employeeId}/${blobId}/verify`, { comment: comment ?? null }).then(r => r.data),

  reject: (employeeId: string, blobId: string, reason: string) =>
    api.post<DocOut>(`/employee-docs/${employeeId}/${blobId}/reject`, { reason }).then(r => r.data),

  softDelete: (employeeId: string, blobId: string) =>
    api.delete(`/employee-docs/${employeeId}/${blobId}`),

  /**
   * Preview streams document bytes through the API gateway.
   * Returns a Blob URL safe for <iframe>/<img> without exposing MinIO.
   */
  fetchPreviewBlob: async (blobId: string) => {
    const resp = await api.get(`/employee-docs/preview/${blobId}`, {
      responseType: "blob",
    });
    return {
      url: URL.createObjectURL(resp.data as Blob),
      mimeType: (resp.headers["content-type"] as string) ?? "application/octet-stream",
      filename: ((resp.headers["content-disposition"] as string) ?? "")
        .match(/filename="?([^"]+)"?/)?.[1] ?? "document",
    };
  },
};

// ── Completion Ring ───────────────────────────────────────────────────────────

function CompletionRing({ pct, ready }: { pct: number; ready: boolean }) {
  const radius = 22;
  const circ   = 2 * Math.PI * radius;
  const dash   = (pct / 100) * circ;
  const color  = ready ? "#10B981" : pct >= 50 ? "#F59E0B" : "#EF4444";

  return (
    <svg width="56" height="56" viewBox="0 0 56 56" className="shrink-0">
      <circle cx="28" cy="28" r={radius} fill="none" stroke="rgba(148,163,184,0.2)" strokeWidth="5" />
      <circle
        cx="28" cy="28" r={radius}
        fill="none"
        stroke={color}
        strokeWidth="5"
        strokeDasharray={`${dash} ${circ}`}
        strokeLinecap="round"
        transform="rotate(-90 28 28)"
        style={{ transition: "stroke-dasharray 0.6s ease" }}
      />
      <text x="28" y="32" textAnchor="middle" fontSize="10" fontWeight="700" fill={color}>
        {Math.round(pct)}%
      </text>
    </svg>
  );
}

// ── Preview Modal ─────────────────────────────────────────────────────────────

interface PreviewState {
  url: string;
  mimeType: string;
  filename: string;
}

function PreviewModal({
  preview,
  onClose,
}: {
  preview: PreviewState;
  onClose: () => void;
}) {
  // Revoke object URL when modal closes to avoid memory leaks.
  useEffect(() => {
    return () => { URL.revokeObjectURL(preview.url); };
  }, [preview.url]);

  const isImage = preview.mimeType.startsWith("image/");
  const isPdf   = preview.mimeType === "application/pdf";

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[9500] flex flex-col bg-slate-900/80 backdrop-blur-sm"
        onClick={onClose}
      >
        {/* Top bar */}
        <div
          className="flex shrink-0 items-center justify-between px-6 py-3 bg-slate-900/90"
          onClick={e => e.stopPropagation()}
        >
          <span className="text-sm font-medium text-slate-200 truncate max-w-lg">
            {preview.filename}
          </span>
          <div className="flex items-center gap-2">
            <a
              href={preview.url}
              download={preview.filename}
              className="flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-white/20 transition-colors"
            >
              <Download className="h-3.5 w-3.5" />
              Download
            </a>
            <button
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-white/10 hover:text-white transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div
          className="flex flex-1 items-center justify-center overflow-hidden p-4"
          onClick={e => e.stopPropagation()}
        >
          {isPdf && (
            <iframe
              src={preview.url}
              title={preview.filename}
              className="h-full w-full max-w-5xl rounded-lg border border-white/10 bg-white"
            />
          )}
          {isImage && (
            <img
              src={preview.url}
              alt={preview.filename}
              className="max-h-full max-w-full rounded-lg object-contain shadow-2xl"
            />
          )}
          {!isPdf && !isImage && (
            <div className="text-center text-slate-300">
              <FileText className="mx-auto mb-3 h-16 w-16 opacity-50" />
              <p className="text-sm">This file type cannot be previewed.</p>
              <a
                href={preview.url}
                download={preview.filename}
                className="mt-4 inline-flex items-center gap-2 rounded-xl bg-white/10 px-4 py-2 text-sm font-medium text-white hover:bg-white/20 transition-colors"
              >
                <Download className="h-4 w-4" />
                Download file
              </a>
            </div>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

// ── Reject Reason Modal ───────────────────────────────────────────────────────

function RejectModal({
  onConfirm,
  onClose,
  isPending,
}: {
  onConfirm: (reason: string) => void;
  onClose: () => void;
  isPending: boolean;
}) {
  const [reason, setReason] = useState("");

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/55 p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.96, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.96, opacity: 0 }}
        className="glass-modal w-full max-w-sm p-6"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 mb-4">
          <AlertTriangle className="h-4 w-4 text-danger shrink-0" />
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Reject Document
          </h3>
        </div>
        <label className="label">Reason *</label>
        <textarea
          autoFocus
          className="input min-h-[80px] resize-none"
          value={reason}
          onChange={e => setReason(e.target.value)}
          placeholder="Explain why this document is being rejected…"
        />
        <div className="mt-4 flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-danger"
            disabled={!reason.trim() || isPending}
            onClick={() => onConfirm(reason.trim())}
          >
            {isPending ? <><Spinner className="h-3.5 w-3.5" />Rejecting…</> : "Reject"}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export function EmployeeDocumentsPanel({
  employeeId,
  title = "Documents",
  description = "Upload and manage employee documents.",
}: {
  employeeId: string;
  title?: string;
  description?: string;
}) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const canManage = hasRole(user, "ORG_ADMIN", "HR_MANAGER", "PAYROLL_ADMIN", "SUPER_ADMIN");

  // ── Query keys ────────────────────────────────────────────────────────────
  const listKey    = [...qk.employee(employeeId), "documents"] as const;
  const missingKey = [...qk.employee(employeeId), "documents", "missing"] as const;
  const statsKey   = [...qk.employee(employeeId), "documents", "stats"] as const;
  const historyKey = [...qk.employee(employeeId), "documents", "history"] as const;

  function invalidateAll() {
    qc.invalidateQueries({ queryKey: listKey });
    qc.invalidateQueries({ queryKey: missingKey });
    qc.invalidateQueries({ queryKey: statsKey });
    qc.invalidateQueries({ queryKey: historyKey });
  }

  // ── Data queries ──────────────────────────────────────────────────────────
  const listQ    = useQuery({ queryKey: listKey,    queryFn: () => empDocApi.list(employeeId) });
  const missingQ = useQuery({ queryKey: missingKey, queryFn: () => empDocApi.missing(employeeId) });
  const statsQ   = useQuery({ queryKey: statsKey,   queryFn: () => empDocApi.stats(employeeId) });
  const historyQ = useQuery({
    queryKey: historyKey,
    queryFn: () => empDocApi.history(employeeId),
    enabled: canManage,
    staleTime: STALE_STABLE,
  });

  // ── Upload state ──────────────────────────────────────────────────────────
  const [file,          setFile]           = useState<File | null>(null);
  const [docCategory,   setDocCategory]    = useState("identity");
  const [docLabel,      setDocLabel]       = useState("AADHAAR_CARD");
  const [customLabel,   setCustomLabel]    = useState("");
  const [descValue,     setDescValue]      = useState("");
  const [isDragging,    setIsDragging]     = useState(false);
  const [uploadOpen,    setUploadOpen]     = useState(true);
  const [historyOpen,   setHistoryOpen]    = useState(false);
  const dropRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // ── Preview state ─────────────────────────────────────────────────────────
  const [preview, setPreview] = useState<PreviewState | null>(null);

  // ── Reject modal state ────────────────────────────────────────────────────
  const [rejectTarget, setRejectTarget] = useState<{ blobId: string } | null>(null);

  // ── Derived label list ────────────────────────────────────────────────────
  const labelOptions = useMemo(
    () => LABELS_BY_CATEGORY[docCategory] ?? ["OTHER"],
    [docCategory]
  );

  // ── Drag-and-drop handlers ────────────────────────────────────────────────
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    if (!dropRef.current?.contains(e.relatedTarget as Node)) {
      setIsDragging(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped) { setFile(dropped); setUploadOpen(true); }
  }, []);

  // ── Mutations ─────────────────────────────────────────────────────────────
  const uploadMut = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Please select a file.");
      const form = new FormData();
      form.append("file", file);
      form.append("doc_category", docCategory);
      form.append("doc_label", docCategory === "custom" ? customLabel.trim().toUpperCase() : docLabel);
      if (descValue.trim()) form.append("description", descValue.trim());
      return empDocApi.upload(employeeId, form);
    },
    onSuccess: () => {
      toastService.success("Document uploaded.");
      setFile(null); setDescValue(""); setCustomLabel("");
      invalidateAll();
    },
    onError: err => toastService.error(extractErrorMessage(err)),
  });

  const verifyMut = useMutation({
    mutationFn: ({ blobId }: { blobId: string }) =>
      empDocApi.verify(employeeId, blobId),
    onSuccess: () => { toastService.success("Document verified."); invalidateAll(); },
    onError: err => toastService.error(extractErrorMessage(err)),
  });

  const rejectMut = useMutation({
    mutationFn: ({ blobId, reason }: { blobId: string; reason: string }) =>
      empDocApi.reject(employeeId, blobId, reason),
    onSuccess: () => {
      toastService.success("Document rejected.");
      setRejectTarget(null);
      invalidateAll();
    },
    onError: err => toastService.error(extractErrorMessage(err)),
  });

  const deleteMut = useMutation({
    mutationFn: (blobId: string) => empDocApi.softDelete(employeeId, blobId),
    onSuccess: () => { toastService.success("Document removed."); invalidateAll(); },
    onError: err => toastService.error(extractErrorMessage(err)),
  });

  // ── Preview handler ───────────────────────────────────────────────────────
  async function openPreview(blobId: string) {
    try {
      const result = await empDocApi.fetchPreviewBlob(blobId);
      setPreview(result);
    } catch {
      toastService.error("Could not load preview.");
    }
  }

  // ── Derived values ────────────────────────────────────────────────────────
  const filledCategories = (listQ.data?.categories ?? []).filter(g => g.count > 0);
  const missingItems     = missingQ.data?.items ?? [];
  const completion       = missingQ.data?.completion_pct ?? 0;
  const ready            = missingQ.data?.is_activation_ready ?? false;
  const stats            = statsQ.data;
  const history          = historyQ.data ?? [];

  const isActing = verifyMut.isPending || rejectMut.isPending || deleteMut.isPending;

  return (
    <>
      {/* ── Preview modal ────────────────────────────────────────────────── */}
      {preview && (
        <PreviewModal preview={preview} onClose={() => setPreview(null)} />
      )}

      {/* ── Reject modal ─────────────────────────────────────────────────── */}
      <AnimatePresence>
        {rejectTarget && (
          <RejectModal
            onConfirm={reason => rejectMut.mutate({ blobId: rejectTarget.blobId, reason })}
            onClose={() => setRejectTarget(null)}
            isPending={rejectMut.isPending}
          />
        )}
      </AnimatePresence>

      <div className="space-y-4">
        {/* ── Header card ─────────────────────────────────────────────────── */}
        <div className="card">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h3 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
                {title}
              </h3>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{description}</p>
              {stats && (
                <div className="mt-2 flex items-center gap-3 text-xs text-slate-400">
                  <span>{stats.total} docs</span>
                  <span>·</span>
                  <span className="text-emerald-600 dark:text-emerald-400">{stats.verified} verified</span>
                  {stats.rejected > 0 && (
                    <><span>·</span><span className="text-danger">{stats.rejected} rejected</span></>
                  )}
                  <span>·</span>
                  <span>{formatBytes(stats.storage_bytes)}</span>
                </div>
              )}
            </div>
            <div className="flex items-end gap-3">
              <div className="text-right">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  KYC Completion
                </div>
                <div className={clsx(
                  "mt-0.5 text-xs font-semibold",
                  ready ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"
                )}>
                  {ready ? "✓ Ready" : `${missingItems.filter(i => !i.present).length} missing`}
                </div>
              </div>
              <CompletionRing pct={completion} ready={ready} />
            </div>
          </div>

          {/* Required documents checklist */}
          {missingItems.length > 0 && (
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {missingItems.map(item => (
                <div
                  key={`${item.doc_category}-${item.doc_label}`}
                  className={clsx(
                    "flex items-center gap-2 rounded-xl border px-3 py-2 text-xs",
                    item.present
                      ? "border-emerald-200 bg-emerald-50/40 dark:border-emerald-800/30 dark:bg-emerald-900/8"
                      : "border-slate-200 bg-slate-50/40 dark:border-slate-800 dark:bg-slate-800/20"
                  )}
                >
                  {item.present
                    ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                    : <div className="h-3.5 w-3.5 shrink-0 rounded-full border-2 border-slate-300 dark:border-slate-600" />
                  }
                  <span className={clsx(
                    "font-medium truncate",
                    item.present
                      ? "text-emerald-700 dark:text-emerald-400"
                      : "text-slate-600 dark:text-slate-400"
                  )}>
                    {humanize(item.doc_label)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Upload card ──────────────────────────────────────────────────── */}
        <div className="card">
          <button
            onClick={() => setUploadOpen(o => !o)}
            className="flex w-full items-center justify-between"
          >
            <div className="flex items-center gap-2">
              <Upload className="h-4 w-4 text-slate-400" />
              <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Upload Document
              </span>
            </div>
            {uploadOpen ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
          </button>

          <AnimatePresence initial={false}>
            {uploadOpen && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <div className="mt-4 space-y-4">
                  {/* Drag-and-drop zone */}
                  <div
                    ref={dropRef}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    onClick={() => inputRef.current?.click()}
                    className={clsx(
                      "flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed p-6 transition-colors duration-150",
                      isDragging
                        ? "border-[#5A52E5] bg-[#5A52E5]/5"
                        : "border-slate-200 dark:border-slate-700 hover:border-[#5A52E5]/50 hover:bg-slate-50 dark:hover:bg-slate-800/40"
                    )}
                  >
                    <input
                      ref={inputRef}
                      type="file"
                      className="sr-only"
                      accept={ALLOWED_EXTENSIONS}
                      onChange={e => setFile(e.target.files?.[0] ?? null)}
                    />
                    <Upload className={clsx("h-8 w-8 mb-2", isDragging ? "text-[#5A52E5]" : "text-slate-300 dark:text-slate-600")} />
                    {file ? (
                      <div className="text-center">
                        <div className="text-sm font-semibold text-slate-800 dark:text-slate-200">{file.name}</div>
                        <div className="text-xs text-slate-400 mt-0.5">{formatBytes(file.size)}</div>
                      </div>
                    ) : (
                      <div className="text-center">
                        <div className="text-sm font-medium text-slate-600 dark:text-slate-400">
                          Drop a file here or <span className="text-[#5A52E5]">browse</span>
                        </div>
                        <div className="text-xs text-slate-400 mt-0.5">
                          PDF, JPG, PNG, DOCX · max 20 MB
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Category + label selectors */}
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="label">Category</label>
                      <select
                        className="input"
                        value={docCategory}
                        onChange={e => {
                          const next = e.target.value;
                          setDocCategory(next);
                          setDocLabel((LABELS_BY_CATEGORY[next] ?? ["OTHER"])[0]);
                        }}
                      >
                        {DOC_CATEGORIES.map(c => (
                          <option key={c.value} value={c.value}>
                            {c.icon} {c.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="label">Document Label</label>
                      {docCategory === "custom" ? (
                        <input
                          className="input"
                          value={customLabel}
                          onChange={e => setCustomLabel(e.target.value)}
                          placeholder="e.g. MEDICAL_POLICY"
                        />
                      ) : (
                        <select
                          className="input"
                          value={docLabel}
                          onChange={e => setDocLabel(e.target.value)}
                        >
                          {labelOptions.map(l => (
                            <option key={l} value={l}>{humanize(l)}</option>
                          ))}
                        </select>
                      )}
                    </div>
                    <div className="sm:col-span-2">
                      <label className="label">Description (optional)</label>
                      <textarea
                        className="input min-h-[64px] resize-none"
                        value={descValue}
                        onChange={e => setDescValue(e.target.value)}
                        placeholder="Notes for HR…"
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs text-slate-400 dark:text-slate-500">
                      Uploading the same document type replaces the previous version.
                    </p>
                    <button
                      className="btn"
                      disabled={
                        uploadMut.isPending || !file ||
                        (docCategory === "custom" ? !customLabel.trim() : !docLabel)
                      }
                      onClick={() => uploadMut.mutate()}
                    >
                      {uploadMut.isPending
                        ? <><Spinner className="h-3.5 w-3.5" />Uploading…</>
                        : <><Upload className="h-3.5 w-3.5" />Upload</>
                      }
                    </button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* ── Document list by category ─────────────────────────────────────── */}
        {listQ.isLoading ? (
          <div className="flex justify-center py-8"><Spinner className="h-6 w-6" /></div>
        ) : filledCategories.length === 0 ? (
          <div className="card py-10 text-center text-sm text-slate-400">
            No documents uploaded yet.
          </div>
        ) : (
          <div className="space-y-3">
            {filledCategories.map(group => (
              <div key={group.category} className="card table-card overflow-hidden p-0">
                {/* Category header */}
                <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/50 px-5 py-3">
                  <div className="flex items-center gap-2">
                    <span className="text-base">{group.icon}</span>
                    <span className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                      {group.label}
                    </span>
                    <span className="rounded-full bg-slate-200/60 dark:bg-slate-700/60 px-2 py-0.5 text-[10px] font-semibold text-slate-500">
                      {group.count}
                    </span>
                  </div>
                </div>

                {/* Documents */}
                <div className="divide-y divide-slate-50 dark:divide-slate-800/40">
                  {group.documents.map(doc => (
                    <DocRow
                      key={doc.id}
                      doc={doc}
                      canManage={canManage}
                      isActing={isActing}
                      onPreview={() => openPreview(doc.id)}
                      onVerify={() => verifyMut.mutate({ blobId: doc.id })}
                      onReject={() => setRejectTarget({ blobId: doc.id })}
                      onDelete={() => deleteMut.mutate(doc.id)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Version history (HR only) ─────────────────────────────────────── */}
        {canManage && history.some(d => d.deleted_at !== null) && (
          <div className="card p-0 overflow-hidden">
            <button
              onClick={() => setHistoryOpen(o => !o)}
              className="flex w-full items-center gap-2 px-5 py-3 text-sm font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
            >
              <History className="h-4 w-4 shrink-0" />
              Version History
              <span className="ml-1 rounded-full bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-[10px] font-semibold text-slate-500">
                {history.filter(d => d.deleted_at !== null).length} superseded
              </span>
              <span className="ml-auto">
                {historyOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </span>
            </button>

            <AnimatePresence initial={false}>
              {historyOpen && (
                <motion.div
                  initial={{ height: 0 }}
                  animate={{ height: "auto" }}
                  exit={{ height: 0 }}
                  className="overflow-hidden border-t border-slate-100 dark:border-slate-800"
                >
                  <div className="divide-y divide-slate-50 dark:divide-slate-800/40">
                    {history
                      .filter(d => d.deleted_at !== null)
                      .map(doc => (
                        <DocRow
                          key={doc.id}
                          doc={doc}
                          canManage={false}
                          isActing={false}
                          onPreview={() => openPreview(doc.id)}
                          isSuperseded
                        />
                      ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
      </div>
    </>
  );
}

// ── Document Row ──────────────────────────────────────────────────────────────

function DocRow({
  doc,
  canManage,
  isActing,
  onPreview,
  onVerify,
  onReject,
  onDelete,
  isSuperseded = false,
}: {
  doc: DocOut;
  canManage: boolean;
  isActing: boolean;
  onPreview: () => void;
  onVerify?: () => void;
  onReject?: () => void;
  onDelete?: () => void;
  isSuperseded?: boolean;
}) {
  return (
    <div
      className={clsx(
        "flex flex-wrap items-center gap-3 px-5 py-3.5 transition-colors hover:bg-slate-50/60 dark:hover:bg-slate-800/20 group",
        isSuperseded && "opacity-55"
      )}
    >
      {/* File icon */}
      <FileText className="h-4 w-4 shrink-0 text-slate-300 dark:text-slate-600" />

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-[13px] font-medium text-slate-900 dark:text-slate-100 truncate">
            {doc.filename}
          </span>
          {isSuperseded && (
            <span className="shrink-0 rounded-full bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 text-[9px] font-semibold text-slate-400 uppercase tracking-wider">
              Superseded
            </span>
          )}
        </div>
        <div className="mt-0.5 text-[11px] text-slate-400 dark:text-slate-500">
          {humanize(doc.doc_label)}
          {" · "}
          {formatBytes(doc.file_size)}
          {" · "}
          {fmtDate(doc.uploaded_at)}
          {doc.rejection_reason && (
            <span className="ml-1.5 text-rose-500 italic">"{doc.rejection_reason}"</span>
          )}
        </div>
      </div>

      {/* Verification status */}
      <div className={clsx(
        "flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold shrink-0",
        statusChip(doc.verification_status)
      )}>
        <StatusIcon status={doc.verification_status} />
        {(doc.verification_status ?? "PENDING").toUpperCase()}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 shrink-0">
        {/* Preview — always */}
        <button
          onClick={onPreview}
          title="Preview"
          className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-300 transition-colors"
        >
          <Eye className="h-3.5 w-3.5" />
        </button>

        {/* HR/admin actions on active docs only */}
        {canManage && !isSuperseded && (
          <>
            {doc.verification_status !== "VERIFIED" && (
              <button
                disabled={isActing}
                onClick={onVerify}
                title="Verify"
                className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-emerald-50 hover:text-emerald-600 dark:hover:bg-emerald-900/20 dark:hover:text-emerald-400 transition-colors disabled:opacity-40"
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
              </button>
            )}
            {doc.verification_status !== "REJECTED" && (
              <button
                disabled={isActing}
                onClick={onReject}
                title="Reject"
                className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-900/20 dark:hover:text-rose-400 transition-colors disabled:opacity-40"
              >
                <XCircle className="h-3.5 w-3.5" />
              </button>
            )}
            <button
              disabled={isActing}
              onClick={onDelete}
              title="Delete"
              className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-danger-light hover:text-danger dark:hover:bg-danger/10 dark:hover:text-danger transition-colors disabled:opacity-40 opacity-0 group-hover:opacity-100"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
