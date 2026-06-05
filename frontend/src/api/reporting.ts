import api from "../lib/api";

export const reportingApi = {
  getPayslipUrl: (cycleId: string, employeeId: string, inline: boolean = false) =>
    api
      .get<{ url: string }>(`/reports/payslip/${cycleId}/${employeeId}`, {
        params: { inline },
      })
      .then((r) => r.data),

  // Use this for single payslip download
  downloadPayslipPdf: async (cycleId: string, employeeId: string) => {
    const { url } = await reportingApi.getPayslipUrl(cycleId, employeeId, false);
    const response = await fetch(url);
    if (!response.ok) throw new Error("Failed to download PDF from storage");
    const blob = await response.blob();
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
};
