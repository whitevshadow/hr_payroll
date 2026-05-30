import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { employeesApi } from "../api/employees";
import { qk } from "../lib/queryClient";
import { PageHeader } from "../components/PageHeader";
import { Modal, ModalFooter } from "../components/Modal";
import { EmptyState } from "../components/EmptyState";
import { SkeletonRow } from "../components/Spinner";
import { extractErrorMessage } from "../lib/toast";
import api from "../lib/api";
import type { Department } from "../types";

export function Departments() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Partial<Department> | null>(null);
  const [formError, setFormError] = useState("");

  const depts = useQuery({
    queryKey: qk.departments,
    queryFn: () => employeesApi.departments(),
  });

  const employees = useQuery({
    queryKey: qk.employees({ page_size: 200, status: "ACTIVE" }),
    queryFn: () => employeesApi.list({ page_size: 200, status: "ACTIVE" }),
  });

  const headcountByDept = (deptId: string) =>
    employees.data?.items.filter((e) => e.department_id === deptId).length ?? 0;

  const saveMut = useMutation({
    mutationFn: async (dept: Partial<Department>) => {
      if (!dept.name?.trim()) throw new Error("Department name is required");
      if (dept.id) {
        return api.put(`/departments/${dept.id}`, { name: dept.name, cost_center: dept.cost_center }).then((r) => r.data);
      }
      return employeesApi.createDepartment(dept.name, dept.cost_center ?? undefined);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.departments });
      setEditing(null);
      setFormError("");
    },
    onError: (err) => setFormError(extractErrorMessage(err)),
  });

  return (
    <div>
      <PageHeader title="Departments" subtitle="Manage your organisation structure">
        <button className="btn" onClick={() => setEditing({ name: "", cost_center: "" })}>
          + New Department
        </button>
      </PageHeader>

      <div className="card overflow-hidden p-0">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-100 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/50">
              <th className="th">Name</th>
              <th className="th">Cost Centre</th>
              <th className="th text-right">Headcount</th>
              <th className="th"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50 dark:divide-slate-800/50">
            {depts.isLoading &&
              Array.from({ length: 3 }).map((_, i) => <SkeletonRow key={i} cols={4} />)}
            {!depts.isLoading && depts.data?.length === 0 && (
              <tr>
                <td colSpan={4}>
                  <EmptyState
                    title="No departments yet"
                    action={
                      <button className="btn" onClick={() => setEditing({ name: "", cost_center: "" })}>
                        + New Department
                      </button>
                    }
                  />
                </td>
              </tr>
            )}
            {depts.data?.map((d) => (
              <tr key={d.id} className="tr-hover">
                <td className="td font-medium text-slate-800 dark:text-slate-200">{d.name}</td>
                <td className="td text-slate-500 dark:text-slate-400">{d.cost_center ?? "—"}</td>
                <td className="td text-right font-numeric text-slate-600 dark:text-slate-400">{headcountByDept(d.id)}</td>
                <td className="td text-right">
                  <button
                    className="text-sm font-medium text-accent-600 hover:text-accent-700 dark:text-accent-400 hover:underline"
                    onClick={() => setEditing(d)}
                  >
                    Edit
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <Modal
          open
          onClose={() => { setEditing(null); setFormError(""); }}
          title={editing.id ? "Edit Department" : "New Department"}
          size="sm"
        >
          <div className="space-y-4">
            <div>
              <label className="label">Name *</label>
              <input
                className="input"
                value={editing.name ?? ""}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              />
            </div>
            <div>
              <label className="label">Cost Centre</label>
              <input
                className="input"
                placeholder="e.g. CC-ENG"
                value={editing.cost_center ?? ""}
                onChange={(e) => setEditing({ ...editing, cost_center: e.target.value })}
              />
            </div>
            {formError && <div className="alert-danger text-sm">{formError}</div>}
          </div>
          <ModalFooter
            onClose={() => { setEditing(null); setFormError(""); }}
            onSave={() => saveMut.mutate(editing)}
            saving={saveMut.isPending}
          />
        </Modal>
      )}
    </div>
  );
}
