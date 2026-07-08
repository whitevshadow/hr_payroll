import { useQuery } from "@tanstack/react-query";
import { Link, useParams, useNavigate } from "react-router-dom";
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

  const urlQ = useQuery({
    queryKey: ["payslip", cycleId, employeeId],
    queryFn: () => reportingApi.getPayslipUrl(cycleId!, employeeId!, true),
    staleTime: Infinity,
  });

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

      <div className="card table-card overflow-hidden p-0 flex-1 min-h-[700px]">
        {urlQ.isLoading && <FullPageSpinner />}
        {urlQ.isError && (
          <div className="flex h-full items-center justify-center text-red-600">
            Could not load payslip PDF.
          </div>
        )}
        {urlQ.data && (
          <iframe
            title="Payslip PDF"
            src={urlQ.data.url}
            className="h-full w-full border-0"
          />
        )}
      </div>
    </div>
  );
}
