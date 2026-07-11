import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, Printer, Eye, RefreshCw } from "lucide-react";
import { useClientContext } from "../lib/ClientContext";
import { clientsApi } from "../api/clients";
import { payrollApi } from "../api/payroll";
import { reportingApi } from "../api/reporting";
import { employeesApi } from "../api/employees";
import { PageHeader } from "../components/PageHeader";
import { EmptyState } from "../components/EmptyState";
import { toastService } from "../lib/toast";
import clsx from "clsx";

export function AdminPayslips() {
  const { selectedClientId, setSelectedClientId } = useClientContext();
  
  const [selectedCycleId, setSelectedCycleId] = useState<string>("");
  const [selectedMonth, setSelectedMonth] = useState<string>(""); // e.g. "2023-01"
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>("");

  const clients = useQuery({
    queryKey: ["clients"],
    queryFn: () => clientsApi.list({ page_size: 200, status: "ACTIVE" }),
  });

  const employees = useQuery({
    queryKey: ["employees", selectedClientId],
    queryFn: () => employeesApi.list({ client_id: selectedClientId || undefined, page_size: 200 }),
    enabled: !!selectedClientId,
  });

  const cycles = useQuery({
    queryKey: ["cycles", selectedClientId],
    queryFn: () => payrollApi.listCycles(selectedClientId || undefined),
  });

  const filteredCycles = useMemo(() => {
    if (!cycles.data) return [];
    let list = cycles.data;
    if (selectedMonth) {
      list = list.filter(c => c.period_start.startsWith(selectedMonth));
    }
    return list;
  }, [cycles.data, selectedMonth]);

  // Use selectedCycleId, or default to the first one in the filtered list
  const activeCycleId = selectedCycleId || (filteredCycles.length > 0 ? filteredCycles[0].id : "");

  const summary = useQuery({
    queryKey: ["cycle-summary", activeCycleId],
    queryFn: () => payrollApi.getCycleSummary(activeCycleId),
    enabled: !!activeCycleId,
  });

  const displayResults = useMemo(() => {
    if (!summary.data) return [];
    let results = summary.data.results || [];
    if (selectedEmployeeId) {
      results = results.filter(r => r.employee_id === selectedEmployeeId);
    }
    return results;
  }, [summary.data, selectedEmployeeId]);

  const handleBulkDownload = async () => {
    if (!activeCycleId) return;
    try {
      toastService.success("Preparing bulk download...");
      await reportingApi.downloadBulkPayslips(activeCycleId);
    } catch (err) {
      toastService.error("Failed to download bulk payslips");
    }
  };

  const handleRegenerate = () => {
    toastService.success("Payslip regeneration triggered");
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Payslips" subtitle="View, download, and manage employee payslips">
        {activeCycleId && (
          <button className="btn btn-primary" onClick={handleBulkDownload}>
            <Download className="h-4 w-4" /> Bulk Download
          </button>
        )}
      </PageHeader>

      <div className="card p-4 flex flex-wrap gap-4 items-end bg-slate-50 dark:bg-slate-800/50">
        <div className="flex flex-col gap-1.5 flex-1 min-w-[200px]">
          <label className="text-xs font-semibold text-slate-500 uppercase">Client</label>
          <select
            className="input"
            value={selectedClientId || ""}
            onChange={(e) => {
              setSelectedClientId(e.target.value || null);
              setSelectedCycleId("");
              setSelectedEmployeeId("");
            }}
          >
            <option value="">All Clients</option>
            {clients.data?.items?.map((c) => (
              <option key={c.id} value={c.id}>{c.client_name}</option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5 flex-1 min-w-[200px]">
          <label className="text-xs font-semibold text-slate-500 uppercase">Month</label>
          <input 
            type="month" 
            className="input" 
            value={selectedMonth}
            onChange={(e) => {
              setSelectedMonth(e.target.value);
              setSelectedCycleId("");
            }}
          />
        </div>

        <div className="flex flex-col gap-1.5 flex-1 min-w-[200px]">
          <label className="text-xs font-semibold text-slate-500 uppercase">Payroll Cycle</label>
          <select
            className="input"
            value={activeCycleId}
            onChange={(e) => setSelectedCycleId(e.target.value)}
          >
            <option value="">Select a Cycle</option>
            {filteredCycles.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.status})
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5 flex-1 min-w-[200px]">
          <label className="text-xs font-semibold text-slate-500 uppercase">Employee</label>
          <select
            className="input"
            value={selectedEmployeeId}
            onChange={(e) => setSelectedEmployeeId(e.target.value)}
            disabled={!selectedClientId}
          >
            <option value="">All Employees</option>
            {employees.data?.items?.map((emp) => (
              <option key={emp.id} value={emp.id}>{emp.first_name} {emp.last_name}</option>
            ))}
          </select>
        </div>
      </div>

      {!activeCycleId ? (
        <EmptyState
          title="No cycle selected"
          description="Please select a payroll cycle to view payslips."
        />
      ) : summary.isLoading ? (
        <div className="card h-40 animate-pulse bg-slate-50 dark:bg-slate-800/50" />
      ) : displayResults.length === 0 ? (
        <EmptyState
          title="No payslips found"
          description="No payslips match your current filters."
        />
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 text-xs font-semibold text-slate-500">
                  <th className="p-4">Employee</th>
                  <th className="p-4">Net Pay</th>
                  <th className="p-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {displayResults.map((res) => {
                  const apiEmp = employees.data?.items?.find(e => e.id === res.employee_id);
                  const empName = apiEmp ? `${apiEmp.first_name} ${apiEmp.last_name}` : (res.breakdown_json?.employee?.name || res.employee_id);
                  const empCode = apiEmp?.emp_code || res.breakdown_json?.employee?.emp_code || "";
                  const isFailed = res.status === "FAILED";
                  return (
                    <tr key={res.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/20 transition-colors">
                      <td className="p-4">
                        <div className="font-medium text-slate-900 dark:text-slate-100">
                          {empName}
                        </div>
                        {empCode && <div className="text-xs text-slate-500 mt-1">{empCode}</div>}
                      </td>
                      <td className="p-4">
                        <span className={clsx("font-numeric font-medium", isFailed ? "text-red-500" : "text-slate-900 dark:text-slate-100")}>
                          {isFailed ? "Failed" : `₹${Number(res.net_pay).toLocaleString()}`}
                        </span>
                      </td>
                      <td className="p-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            disabled={isFailed}
                            onClick={async () => {
                              try {
                                await reportingApi.openPayslip(activeCycleId, res.employee_id);
                              } catch (e) {
                                toastService.error("Failed to load payslip");
                              }
                            }}
                            className="btn btn-sm btn-ghost text-slate-600 hover:text-blue-600"
                            title="View"
                          >
                            <Eye className="h-4 w-4" />
                          </button>
                          <button
                            disabled={isFailed}
                            onClick={async () => {
                              try {
                                await reportingApi.downloadPayslipPdf(activeCycleId, res.employee_id);
                              } catch (e) {
                                toastService.error("Failed to download payslip");
                              }
                            }}
                            className="btn btn-sm btn-ghost text-slate-600 hover:text-emerald-600"
                            title="Download"
                          >
                            <Download className="h-4 w-4" />
                          </button>
                          <button
                            disabled={isFailed}
                            onClick={async () => {
                               try {
                                await reportingApi.openPayslip(activeCycleId, res.employee_id, true);
                              } catch (e) {
                                toastService.error("Failed to print payslip");
                              }
                            }}
                            className="btn btn-sm btn-ghost text-slate-600 hover:text-purple-600"
                            title="Print"
                          >
                            <Printer className="h-4 w-4" />
                          </button>
                          <button
                            onClick={handleRegenerate}
                            className="btn btn-sm btn-ghost text-slate-600 hover:text-amber-600"
                            title="Regenerate"
                          >
                            <RefreshCw className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
