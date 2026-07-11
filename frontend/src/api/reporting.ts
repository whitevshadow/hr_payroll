import api from "../lib/api";

export const reportingApi = {
  /** Fetch the payslip PDF bytes through the gateway (same origin, bearer token).
   *  We no longer ask for a presigned MinIO URL: the object store publishes no
   *  host port, so the browser cannot reach one. */
  getPayslipBlob: (cycleId: string, employeeId: string, inline: boolean = true) =>
    api
      .get(`/reports/payslip/${cycleId}/${employeeId}/pdf`, {
        params: { inline },
        responseType: "blob",
      })
      .then((r) => r.data as Blob),

  /** Open the payslip in a new tab (optionally triggering print).
   *  Uses an object URL built from the authenticated fetch — window.open on a
   *  presigned MinIO URL no longer works. */
  openPayslip: async (cycleId: string, employeeId: string, print: boolean = false) => {
    const blob = await reportingApi.getPayslipBlob(cycleId, employeeId, true);
    const objectUrl = URL.createObjectURL(blob);
    const win = window.open(objectUrl, "_blank");
    if (print && win) {
      win.addEventListener("load", () => win.print());
    }
    // Revoke late: the new tab still needs to load from this URL.
    setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
  },

  // Use this for single payslip download
  downloadPayslipPdf: async (cycleId: string, employeeId: string) => {
    const blob = await reportingApi.getPayslipBlob(cycleId, employeeId, false);
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = `payslip_${employeeId}.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(objectUrl);
  },

  // Use this for bulk downloading a cycle's payslips
  downloadBulkPayslips: async (cycleId: string) => {
    const response = await api.get(`/reports/payslips/bulk/${cycleId}`, {
      responseType: "blob",
    });
    const url = URL.createObjectURL(response.data as Blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `payslips_cycle_${cycleId}.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },

  generateReport: (body: { report_type: string; cycle_id?: string; employee_ids?: string[]; client_id?: string; financial_year?: string }) => 
    api.post("/reports/generate", body).then((r) => r.data),
};
