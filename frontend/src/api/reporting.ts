import api from "../lib/api";

export const reportingApi = {
  getPayslipHtml: (cycleId: string, employeeId: string) =>
    api
      .get<string>(`/reports/payslip/${cycleId}/${employeeId}`, {
        responseType: "text",
      })
      .then((r) => r.data),

  downloadPayslipPdf: async (cycleId: string, employeeId: string) => {
    const response = await api.get(
      `/reports/payslip/${cycleId}/${employeeId}`,
      { params: { format: "pdf" }, responseType: "blob" }
    );
    const url = URL.createObjectURL(response.data as Blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `payslip_${employeeId}.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },
};
