import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { FileText, Download, CheckCircle2, XCircle, Clock, UploadCloud, Eye, Trash2, Calendar, File } from "lucide-react";
import { clientsApi } from "../api/clients";
import { blobstoreApi } from "../api/blobstore";
import { Client, ClientDocument } from "../types";
import { qk } from "../lib/queryClient";
import { getToken } from "../lib/auth";
import { Spinner } from "./Spinner";
import { StatusBadge } from "./StatusBadge";
import clsx from "clsx";
import toast from "react-hot-toast";

interface Props {
  client: Client;
}

export function ClientDocumentsPanel({ client }: Props) {
  const queryClient = useQueryClient();
  const [activeCategory, setActiveCategory] = useState<string>("ALL");
  const [isUploading, setIsUploading] = useState(false);

  // Form State
  const [file, setFile] = useState<File | null>(null);
  const [docCategory, setDocCategory] = useState("GST");
  const [docLabel, setDocLabel] = useState("");
  const [description, setDescription] = useState("");
  const [expiryDate, setExpiryDate] = useState("");

  const docsQ = useQuery({
    queryKey: qk.clientDocs(client.id),
    queryFn: () => clientsApi.listDocuments(client.id, activeCategory !== "ALL" ? activeCategory : undefined),
  });

  const uploadMutation = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Please select a file");
      
      // 1. Upload to Blobstore
      const uploadRes = await blobstoreApi.upload(file, "client_doc");
      
      // 2. Create document record
      return clientsApi.createDocument(client.id, {
        blob_id: uploadRes.blob_id,
        doc_category: docCategory,
        doc_label: docLabel || file.name,
        description: description || undefined,
        expiry_date: expiryDate || undefined,
      });
    },
    onSuccess: () => {
      toast.success("Document uploaded successfully");
      queryClient.invalidateQueries({ queryKey: qk.clientDocs(client.id) });
      setFile(null);
      setDocLabel("");
      setDescription("");
      setExpiryDate("");
      setIsUploading(false);
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.detail || "Upload failed");
    },
  });

  const verifyMutation = useMutation({
    mutationFn: ({ docId, status }: { docId: string; status: "APPROVED" | "REJECTED" }) =>
      clientsApi.verifyDocument(client.id, docId, status),
    onSuccess: () => {
      toast.success("Document verification updated");
      queryClient.invalidateQueries({ queryKey: qk.clientDocs(client.id) });
    },
  });

  const handleDownload = (doc: ClientDocument) => {
    // Generate pre-signed URL or directly hit the blob endpoint if authentication is passed via cookies
    // For this implementation, we assume the token is in localStorage, so an anchor tag might fail.
    // Instead we fetch it as a blob and trigger download.
    const url = blobstoreApi.downloadUrl(doc.blob_id);
    
    fetch(url, {
      headers: {
        Authorization: `Bearer ${getToken()}`,
      },
    })
      .then((res) => res.blob())
      .then((blob) => {
        const objectUrl = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = objectUrl;
        a.download = doc.doc_label;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(objectUrl);
        document.body.removeChild(a);
      })
      .catch(() => toast.error("Download failed"));
  };

  const categories = ["ALL", "GST", "PAN", "TAN", "Agreements", "Licenses", "OTHER"];

  return (
    <div className="space-y-6">
      {/* Header & Upload Button */}
      <div className="flex items-center justify-between">
        <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={clsx(
                "px-3 py-1.5 text-xs font-semibold rounded-full transition-colors whitespace-nowrap",
                activeCategory === cat
                  ? "bg-accent-100 text-accent-700 dark:bg-accent-900/40 dark:text-accent-300"
                  : "bg-slate-100 text-slate-500 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700"
              )}
            >
              {cat}
            </button>
          ))}
        </div>
        <button
          onClick={() => setIsUploading(!isUploading)}
          className="btn-secondary h-8 text-xs gap-1.5 whitespace-nowrap ml-4"
        >
          {isUploading ? "Cancel Upload" : (
            <>
              <UploadCloud className="h-3.5 w-3.5" /> Upload Document
            </>
          )}
        </button>
      </div>

      {/* Upload Form */}
      {isUploading && (
        <div className="bg-slate-50 dark:bg-slate-800/50 rounded-xl p-4 border border-slate-100 dark:border-slate-800 mb-6 animate-in fade-in slide-in-from-top-2">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-4">Upload New Document</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="col-span-full">
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
                File
              </label>
              <input
                type="file"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
                className="block w-full text-sm text-slate-500 dark:text-slate-400
                  file:mr-4 file:py-2 file:px-4
                  file:rounded-full file:border-0
                  file:text-xs file:font-semibold
                  file:bg-accent-50 file:text-accent-700
                  hover:file:bg-accent-100
                  dark:file:bg-accent-900/30 dark:file:text-accent-300"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
                Category
              </label>
              <select
                value={docCategory}
                onChange={(e) => setDocCategory(e.target.value)}
                className="input h-9 text-sm"
              >
                {categories.filter(c => c !== "ALL").map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
                Document Label
              </label>
              <input
                type="text"
                placeholder="e.g. GST Certificate 2024"
                value={docLabel}
                onChange={(e) => setDocLabel(e.target.value)}
                className="input h-9 text-sm"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
                Expiry Date (Optional)
              </label>
              <input
                type="date"
                value={expiryDate}
                onChange={(e) => setExpiryDate(e.target.value)}
                className="input h-9 text-sm"
              />
            </div>
            <div className="col-span-full">
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
                Description (Optional)
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="input text-sm min-h-[60px] py-2"
                placeholder="Brief description of the document contents"
              />
            </div>
            <div className="col-span-full flex justify-end mt-2">
              <button
                disabled={!file || uploadMutation.isPending}
                onClick={() => uploadMutation.mutate()}
                className="btn-primary"
              >
                {uploadMutation.isPending ? <Spinner className="h-4 w-4" /> : "Upload Document"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Documents List */}
      {docsQ.isLoading ? (
        <div className="flex justify-center p-8">
          <Spinner className="h-6 w-6" />
        </div>
      ) : docsQ.data?.length === 0 ? (
        <div className="text-center py-10 bg-slate-50 dark:bg-slate-800/30 rounded-xl border border-dashed border-slate-200 dark:border-slate-800">
          <File className="mx-auto h-8 w-8 text-slate-300 mb-3" />
          <h3 className="text-sm font-medium text-slate-900 dark:text-white">No documents found</h3>
          <p className="mt-1 text-xs text-slate-500">
            {activeCategory === "ALL" ? "Upload documents to get started." : `No documents in category ${activeCategory}.`}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {docsQ.data?.map((doc) => (
            <div key={doc.id} className="card p-4 flex flex-col sm:flex-row sm:items-center gap-4 group">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-900/30">
                <FileText className="h-5 w-5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h4 className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                    {doc.doc_label}
                  </h4>
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-bold tracking-wide uppercase bg-slate-100 text-slate-500 dark:bg-slate-800">
                    {doc.doc_category}
                  </span>
                </div>
                {doc.description && (
                  <p className="text-xs text-slate-500 truncate mt-0.5">{doc.description}</p>
                )}
                <div className="flex items-center gap-4 mt-2 text-[11px] text-slate-400">
                  <span className="flex items-center gap-1">
                    <Calendar className="h-3 w-3" />
                    Uploaded {format(new Date(doc.created_at), "MMM d, yyyy")}
                  </span>
                  {doc.expiry_date && (
                    <span className="flex items-center gap-1 text-amber-600 dark:text-amber-500">
                      <Clock className="h-3 w-3" />
                      Expires {format(new Date(doc.expiry_date), "MMM d, yyyy")}
                    </span>
                  )}
                  <span className="flex items-center gap-1">
                    {doc.verification_status === "APPROVED" ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                    ) : doc.verification_status === "REJECTED" ? (
                      <XCircle className="h-3.5 w-3.5 text-rose-500" />
                    ) : (
                      <Clock className="h-3.5 w-3.5 text-amber-500" />
                    )}
                    {doc.verification_status}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2 mt-4 sm:mt-0 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                {doc.verification_status === "PENDING" && (
                  <>
                    <button
                      title="Approve"
                      onClick={() => verifyMutation.mutate({ docId: doc.id, status: "APPROVED" })}
                      className="p-1.5 rounded-lg text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/30 transition-colors"
                    >
                      <CheckCircle2 className="h-4 w-4" />
                    </button>
                    <button
                      title="Reject"
                      onClick={() => verifyMutation.mutate({ docId: doc.id, status: "REJECTED" })}
                      className="p-1.5 rounded-lg text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/30 transition-colors"
                    >
                      <XCircle className="h-4 w-4" />
                    </button>
                    <div className="w-px h-4 bg-slate-200 dark:bg-slate-700 mx-1" />
                  </>
                )}
                
                <button
                  title="Download"
                  onClick={() => handleDownload(doc)}
                  className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white transition-colors"
                >
                  <Download className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
