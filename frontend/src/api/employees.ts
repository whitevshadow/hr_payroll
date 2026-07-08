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
  client_id?: string;
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
  locations: (active_only: boolean = true) =>
    api.get<import("../types").Location[]>("/locations", { params: { active_only } }).then((r) => r.data),

  createLocation: (data: { location_code: string; location_name: string; city: string; state: string; country: string }) =>
    api.post<import("../types").Location>("/locations", data).then((r) => r.data),

  updateLocation: (id: string, data: { is_active: boolean }) =>
    api.put<import("../types").Location>(`/locations/${id}`, data).then((r) => r.data),

  /** Financial Years */
  financialYears: () =>
    api.get<any[]>("/financial-years").then(r => r.data),
  
  createFinancialYear: (data: { year_label: string; start_date: string; end_date: string; is_active: boolean }) =>
    api.post<any>("/financial-years", data).then(r => r.data),
    
  activateFinancialYear: (id: string) =>
    api.patch<any>(`/financial-years/${id}/activate`).then(r => r.data),

  /** Bulk-import employees from an array of parsed rows. */
  bulkImport: (rows: BulkImportRow[]) =>
    api.post<BulkImportResult>("/employees/bulk-import", { rows }).then((r) => r.data),
};

export interface BulkImportRow {
  emp_code: string;
  first_name: string;
  last_name: string;
  email?: string;
  mobile?: string;
  department?: string;
  designation?: string;
  work_location?: string;
  joining_date?: string;         // ISO YYYY-MM-DD
  employment_type?: string;
  basic_salary?: number;         // annual CTC — used by frontend to call salary-service
  pan_number?: string;
  uan_number?: string;
  bank_account?: string;
  bank_ifsc?: string;
  gender?: string;
  date_of_birth?: string;
  state?: string;
  city?: string;
  branch?: string;
}

export interface RowResult {
  row_index: number;
  emp_code: string;
  name: string;
  status: "created" | "duplicate" | "error";
  error?: string;
  employee_id?: string;
  work_location?: string;
}

export interface BulkImportResult {
  total: number;
  created: number;
  duplicates: number;
  errors: number;
  rows: RowResult[];
}
