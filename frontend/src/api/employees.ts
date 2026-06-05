import api from "../lib/api";
import type {
  Department,
  Employee,
  EmployeeCreate,
  EmployeePage,
  EmployeeUpdate,
} from "../types";

export interface EmployeeListParams {
  page?: number;
  page_size?: number;
  search?: string;
  status?: string;
}

export const employeesApi = {
  /** Paginated / filtered employee list. */
  list: (params: EmployeeListParams = {}) =>
    api.get<EmployeePage>("/employees", { params }).then((r) => r.data),

  /** Resolve the authenticated user to their own employee record (by email). */
  me: () =>
    api.get<Employee>("/employees/me").then((r) => r.data),

  /** Fetch a single employee by UUID. */
  get: (id: string) =>
    api.get<Employee>(`/employees/${id}`).then((r) => r.data),

  /** Create a new employee. */
  create: (body: EmployeeCreate) =>
    api.post<Employee>("/employees", body).then((r) => r.data),

  /** Update mutable fields on an existing employee. */
  update: (id: string, body: EmployeeUpdate) =>
    api.put<Employee>(`/employees/${id}`, body).then((r) => r.data),

  /** List all departments in the current tenant. */
  departments: () =>
    api.get<Department[]>("/departments").then((r) => r.data),

  /** Create a new department. */
  createDepartment: (name: string, costCenter?: string) =>
    api
      .post<Department>("/departments", { name, cost_center: costCenter })
      .then((r) => r.data),

  /** List all locations in the current tenant. */
  locations: () =>
    api.get<import("../types").Location[]>("/locations").then((r) => r.data),
};
