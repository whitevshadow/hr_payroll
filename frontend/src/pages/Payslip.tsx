import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { reportingApi } from "../api/reporting";
import { PageHeader } from "../components/PageHeader";
import { FullPageSpinner } from "../components/Spinner";
import { toastService, extractErrorMessage } from "../lib/toast";

export function Payslip() {
  const { cycleId, employeeId } = useParams<{
    cycleId: string;
    employeeId: string;
  }>();

  const htmlQ = useQuery({
    queryKey: ["payslip", cycleId, employeeId],
    queryFn: () => reportingApi.getPayslipHtml(cycleId!, employeeId!),
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
    <div>
      <PageHeader title="Payslip">
        <Link to={`/cycles/${cycleId}/summary`} className="btn-ghost">
          ← Summary
        </Link>
        <button className="btn" onClick={downloadPdf}>
          Download PDF
        </button>
      </PageHeader>

      <div className="card overflow-hidden p-0" style={{ height: "700px" }}>
        {htmlQ.isLoading && <FullPageSpinner />}
        {htmlQ.isError && (
          <div className="flex h-full items-center justify-center text-red-600">
            Could not load payslip.
          </div>
        )}
        {htmlQ.data && (
          <iframe
            title="Payslip"
            srcDoc={htmlQ.data}
            sandbox="allow-same-origin"
            className="h-full w-full border-0"
          />
        )}
      </div>
    </div>
  );
}
