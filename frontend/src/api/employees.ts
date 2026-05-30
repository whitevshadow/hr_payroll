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
  list: (params: EmployeeListParams = {}) =>
    api
      .get<EmployeePage>("/employees", { params })
      .then((r) => r.data),

  get: (id: string) =>
    api.get<Employee>(`/employees/${id}`).then((r) => r.data),

  create: (body: EmployeeCreate) =>
    api.post<Employee>("/employees", body).then((r) => r.data),

  update: (id: string, body: EmployeeUpdate) =>
    api.put<Employee>(`/employees/${id}`, body).then((r) => r.data),

  departments: () =>
    api.get<Department[]>("/departments").then((r) => r.data),

  createDepartment: (name: string, costCenter?: string) =>
    api
      .post<Department>("/departments", { name, cost_center: costCenter })
      .then((r) => r.data),
};
