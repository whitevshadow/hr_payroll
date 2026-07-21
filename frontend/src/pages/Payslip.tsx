import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams, useNavigate } from "react-router-dom";
import { reportingApi } from "../api/reporting";
import { PageHeader } from "../components/PageHeader";
import { FullPageSpinner } from "../components/Spinner";
import { toastService, extractErrorMessage } from "../lib/toast";

export function Payslip() {
  const { cycleId, employeeId } = useParams<{
    cycleId: string;
    employeeId: string;
  }>();
  const navigate = useNavigate();

  // Fetch the PDF bytes with our bearer token, then render them from an object
  // URL. An <iframe src> cannot carry an Authorization header, so it can only
  // display a self-authenticating URL — and presigned MinIO URLs are no longer
  // reachable from the browser (the object store publishes no host port).
  const pdfQ = useQuery({
    queryKey: ["payslip", cycleId, employeeId],
    queryFn: () => reportingApi.getPayslipBlob(cycleId!, employeeId!, true),
    staleTime: Infinity,
    retry: false,
  });

  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!pdfQ.data) return;
    const url = URL.createObjectURL(pdfQ.data);
    setObjectUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [pdfQ.data]);

  async function downloadPdf() {
    try {
      await reportingApi.downloadPayslipPdf(cycleId!, employeeId!);
    } catch (err) {
      toastService.error(extractErrorMessage(err));
    }
  }

  return (
    <div className="flex flex-col h-full">
      <PageHeader title="Payslip">
        <button onClick={() => navigate(-1)} className="btn-ghost">
          ← Back
        </button>
        <button className="btn" onClick={downloadPdf}>
          Download PDF
        </button>
      </PageHeader>

      {/* The card needs a definite height (not just min-height): the iframe
          fills it as a flex item, since a percentage height cannot resolve
          against the layout's auto-height content wrapper. */}
      <div className="card table-card overflow-hidden p-0 flex flex-col h-[calc(100vh-180px)] min-h-[600px]">
        {pdfQ.isLoading && <FullPageSpinner />}
        {pdfQ.isError && (
          <div className="flex flex-1 flex-col items-center justify-center gap-1 text-center">
            <p className="font-medium text-red-600">Could not load payslip PDF.</p>
            <p className="text-sm text-slate-500">
              It may not have been generated yet for this cycle.
            </p>
          </div>
        )}
        {objectUrl && (
          <iframe
            title="Payslip PDF"
            src={objectUrl}
            className="w-full flex-1 border-0"
          />
        )}
      </div>
    </div>
  );
}
