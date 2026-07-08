# 🧪 PeopleOS — Full System Test Guide

> **App URL:** http://localhost:5173  
> **API Gateway:** http://localhost:8000  
> **All services running:** ✅ auth, employee, client, salary, attendance, payroll, compliance, tds, payout, reporting

---

## 📋 Test Sequence Overview

The tests must be run **in this order** because each phase depends on data from the previous one.

| Phase | Module | What It Tests |
|-------|--------|---------------|
| 1 | Auth | Register tenant & login |
| 2 | Clients | Create a client company |
| 3 | Locations | Add office locations for the client |
| 4 | Departments | Add departments |
| 5 | Employees | Add employees and assign salary |
| 6 | Salary Templates | Create a salary structure |
| 7 | Attendance | Mark monthly attendance |
| 8 | Payroll Cycle | Run payroll for the month |
| 9 | Compliance | Check PF/ESIC calculations |
| 10 | TDS | Review TDS deductions |
| 11 | Payouts | Generate bank transfer file |
| 12 | Reports | Download payslips & reports |

---

## 🔑 Phase 1 — Register & Login

### Test 1.1 — Register a new tenant (first-time setup)

**Where:** http://localhost:5173/login → click **"Register"**

| Field | Value |
|-------|-------|
| Organization Name | `Nexus Tech Solutions` |
| Email | `admin@nexustech.com` |
| Password | `Admin@1234` |

**Expected:** You are logged in and redirected to the Dashboard.  
**Check:** Top-right shows `admin@nexustech.com`. Sidebar shows all admin navigation items.

---

### Test 1.2 — Logout and Login again

1. Click profile icon → **Logout**
2. Visit http://localhost:5173/login

| Field | Value |
|-------|-------|
| Email | `admin@nexustech.com` |
| Password | `Admin@1234` |

**Expected:** Successfully logged back in, Dashboard visible.

---

## 🏢 Phase 2 — Clients

### Test 2.1 — Create Client 1

**Where:** Sidebar → **Clients** → **Add Client**

| Field | Value |
|-------|-------|
| Client Code | `ACME001` |
| Client Name | `Acme Manufacturing Pvt Ltd` |
| Legal Name | `Acme Manufacturing Private Limited` |
| Industry | `Manufacturing` |
| Status | `ACTIVE` |
| Address Line 1 | `Plot No. 45, MIDC Industrial Area` |
| City | `Pune` |
| State | `Maharashtra` |
| Pincode | `411019` |
| Contact Person | `Rajesh Kumar` |
| Contact Email | `rajesh@acme.com` |
| Contact Mobile | `9876543210` |
| GST Number | `27AABCU9603R1ZX` |
| PAN Number | `AABCU9603R` |
| Payroll Start Date | `2025-04-01` |
| Financial Year | `2025-26` |
| Payroll Frequency | `MONTHLY` |

**Expected:** Client card appears in the clients list.

---

### Test 2.2 — Create Client 2

| Field | Value |
|-------|-------|
| Client Code | `INFOEDGE01` |
| Client Name | `InfoEdge Software Solutions` |
| Industry | `IT Services` |
| Status | `ACTIVE` |
| City | `Bengaluru` |
| State | `Karnataka` |
| Pincode | `560001` |
| Contact Person | `Priya Sharma` |
| Contact Email | `priya@infoedge.com` |
| Payroll Start Date | `2025-04-01` |
| Financial Year | `2025-26` |

**Expected:** Two clients visible in the list.

---

## 📍 Phase 3 — Locations

> ⚠️ First, select **ACME Manufacturing** from the **Client Selector** (top-right dropdown).

**Where:** Sidebar → **Locations** → **Add Location**

### Test 3.1 — Add Location for Acme

| Field | Value |
|-------|-------|
| Location Code | `PUNE-HQ` |
| Location Name | `Pune Head Office` |
| Address | `Plot 45, MIDC, Pune - 411019` |
| State | `Maharashtra` |
| Active | ✅ Yes |

**Expected:** Location appears in the Locations list.

### Test 3.2 — Switch to InfoEdge and Add Location

1. Change client selector to **InfoEdge Software Solutions**
2. Add Location:

| Field | Value |
|-------|-------|
| Location Code | `BLR-HQ` |
| Location Name | `Bengaluru Head Office` |
| Address | `No. 12, MG Road, Bengaluru - 560001` |
| State | `Karnataka` |

---

## 🏛️ Phase 4 — Departments

> Select **ACME Manufacturing** from the client selector.

**Where:** Sidebar → **Departments** → **Add Department**

### Test 4.1 — Create Departments for Acme

Add each of these one by one:

| Dept Code | Dept Name | Description |
|-----------|-----------|-------------|
| `PROD` | Production | Shop floor manufacturing team |
| `HR` | Human Resources | HR & Admin team |
| `FINANCE` | Finance & Accounts | Accounts and payroll |
| `ADMIN` | Administration | General admin |

**Expected:** All 4 departments listed under the Acme client.

---

## 👤 Phase 5 — Employees

> Select **ACME Manufacturing** from the client selector.

**Where:** Sidebar → **Employees** → **Add Employee**

### Test 5.1 — Employee 1

| Field | Value |
|-------|-------|
| Employee Code | `EMP001` |
| First Name | `Amit` |
| Last Name | `Verma` |
| Email | `amit.verma@acme.com` |
| Mobile | `9876500001` |
| Date of Joining | `2023-04-01` |
| Date of Birth | `1992-06-15` |
| Designation | `Production Supervisor` |
| Department | `Production` |
| Location | `Pune Head Office` |
| Employment Type | `FULL_TIME` |
| Status | `ACTIVE` |
| PAN | `ABCDE1234F` |
| PF Applicable | ✅ Yes |
| ESIC Applicable | ✅ Yes (if gross < ₹21,000) |
| Bank Account | `1234567890` |
| Bank IFSC | `SBIN0001234` |
| Bank Name | `State Bank of India` |

---

### Test 5.2 — Employee 2

| Field | Value |
|-------|-------|
| Employee Code | `EMP002` |
| First Name | `Sunita` |
| Last Name | `Patil` |
| Email | `sunita.patil@acme.com` |
| Mobile | `9876500002` |
| Date of Joining | `2022-01-15` |
| Date of Birth | `1990-03-22` |
| Designation | `HR Manager` |
| Department | `Human Resources` |
| Location | `Pune Head Office` |
| Employment Type | `FULL_TIME` |
| PAN | `FGHIJ5678K` |
| PF Applicable | ✅ Yes |

---

### Test 5.3 — Employee 3

| Field | Value |
|-------|-------|
| Employee Code | `EMP003` |
| First Name | `Ravi` |
| Last Name | `Nair` |
| Email | `ravi.nair@acme.com` |
| Mobile | `9876500003` |
| Date of Joining | `2024-07-01` |
| Designation | `Accounts Executive` |
| Department | `Finance & Accounts` |
| PAN | `LMNOP9012Q` |
| PF Applicable | ✅ Yes |

**Expected:** All 3 employees visible in the employees list with their details.

---

### Test 5.4 — View Employee Detail

Click on **Amit Verma** → Review detail page showing:
- Personal info tab
- Employment info tab
- Bank details tab
- Documents tab

---

## 💰 Phase 6 — Salary Templates & Assignments

### Test 6.1 — Create a Salary Template

**Where:** Sidebar → **Salary** → **Templates** → **New Template**

| Field | Value |
|-------|-------|
| Template Name | `Standard Monthly - Acme` |
| Description | `Default monthly payroll structure for Acme` |

**Earnings Components:**

| Component | Type | Value |
|-----------|------|-------|
| Basic Salary | Fixed/% | 40% of CTC |
| HRA | % of Basic | 50% |
| Special Allowance | Fixed | ₹5,000 |
| Conveyance Allowance | Fixed | ₹1,600 |

**Deductions:**

| Component | Type | Value |
|-----------|------|-------|
| Provident Fund (Employee) | % | 12% of Basic |
| Professional Tax | Fixed | ₹200/month |

---

### Test 6.2 — Assign Salary to Employees

**Where:** Employees → Click **Amit Verma** → **Salary** tab → **Assign Salary**

| Field | Value |
|-------|-------|
| CTC (Annual) | `3,60,000` |
| Gross Monthly | `30,000` |
| Basic | `12,000` |
| HRA | `6,000` |
| Special Allowance | `5,000` |
| Conveyance | `1,600` |
| Effective From | `2025-04-01` |

Repeat for **Sunita Patil**:

| Field | Value |
|-------|-------|
| CTC (Annual) | `6,00,000` |
| Gross Monthly | `50,000` |
| Basic | `20,000` |
| HRA | `10,000` |
| Effective From | `2025-04-01` |

Repeat for **Ravi Nair**:

| Field | Value |
|-------|-------|
| CTC (Annual) | `2,40,000` |
| Gross Monthly | `20,000` |
| Basic | `8,000` |
| HRA | `4,000` |
| Effective From | `2025-04-01` |

---

## 📅 Phase 7 — Attendance

> Ensure **ACME Manufacturing** is selected in the client selector.

**Where:** Sidebar → **Attendance**

### Test 7.1 — Set Month and Mark Attendance

1. Select Month: **June 2025**
2. Click **Grid View** tab
3. For **Amit Verma (EMP001)**: Mark all weekdays `P`, Sundays `WO` → 26 Present, 4 WO
4. For **Sunita Patil (EMP002)**: Mark 24 Present, 2 days `LOP`, 4 WO
5. For **Ravi Nair (EMP003)**: Mark 25 Present, 1 day `H` (Holiday), 4 WO
6. Click **Save All**

**Expected:** Attendance summary shows correct present/LOP/payable days.

### Test 7.2 — Lock Attendance

Click **Lock Attendance** → Confirm.

| Expected Behaviour | Result |
|-------------------|--------|
| Status changes to `LOCKED` | ✅ |
| Grid becomes read-only | ✅ |
| Payroll run can now proceed | ✅ |

---

## 🚀 Phase 8 — Payroll Cycle

**Where:** Sidebar → **Payroll** → **Cycles** → **New Cycle**

### Test 8.1 — Create Payroll Cycle

| Field | Value |
|-------|-------|
| Cycle Name | `Acme June 2025` |
| Client | `Acme Manufacturing Pvt Ltd` |
| Period Start | `2025-06-01` |
| Period End | `2025-06-30` |
| Financial Year | `2025-26` |
| Dry Run | ✅ Yes (first run to verify) |

Click **Create Cycle**.

### Test 8.2 — Run Payroll (Dry Run)

1. Open the **Acme June 2025** cycle
2. Click **Run Payroll**
3. Review the computed results:
   - Gross Pay per employee
   - PF deductions
   - Professional Tax
   - Net Pay
4. Verify Amit: Gross ₹30,000 → PF ₹1,440 → PT ₹200 → Net ~₹28,360
5. Verify Sunita (2 LOP days): Gross reduced → PF recalculated

### Test 8.3 — Run Actual Payroll

1. Edit cycle → uncheck **Dry Run**
2. Click **Run Payroll** again
3. Click **Approve Cycle** (if approval step exists)

**Expected:** Cycle status changes to `APPROVED` or `FINALIZED`.

---

## 🛡️ Phase 9 — Compliance

**Where:** Sidebar → **Compliance**

### Test 9.1 — Review PF Challan

Select **Client:** Acme Manufacturing, **Month:** June 2025

| Check | Expected |
|-------|----------|
| Employee PF (12% of basic) | Amit: ₹1,440 |
| Employer PF (12% of basic) | Amit: ₹1,440 |
| Total PF for 3 employees | Calculated correctly |
| ESIC (if applicable) | For employees with gross < ₹21,000 |

### Test 9.2 — Download PF ECR

Click **Download ECR** → Verify the file opens with correct UAN/PF numbers.

---

## 🧾 Phase 10 — TDS

**Where:** Sidebar → **TDS**

### Test 10.1 — Review TDS Projection

Select **Employee:** Amit Verma, **Financial Year:** 2025-26

| Field | Expected |
|-------|----------|
| Annual Gross | ₹3,60,000 |
| Standard Deduction | ₹50,000 |
| Taxable Income | ~₹3,10,000 |
| TDS (if applicable) | ₹0 (below basic slab) |

### Test 10.2 — Review TDS for Sunita Patil

| Field | Expected |
|-------|----------|
| Annual Gross | ₹6,00,000 |
| Standard Deduction | ₹50,000 |
| Taxable Income | ~₹5,50,000 |
| TDS/year | Calculated based on tax slab |
| Monthly TDS | Deducted & shown |

---

## 💸 Phase 11 — Payouts

**Where:** Sidebar → **Payouts**

### Test 11.1 — Generate Bank Transfer File

1. Select **Payroll Cycle:** Acme June 2025
2. Click **Generate Payout File**
3. Choose format: **NEFT/RTGS**

**Expected output:**

| Employee | Account No | IFSC | Net Pay |
|----------|-----------|------|---------|
| Amit Verma | 1234567890 | SBIN0001234 | ~₹28,360 |
| Sunita Patil | (assigned) | (assigned) | ~₹48,200 |
| Ravi Nair | (assigned) | (assigned) | ~₹19,400 |

### Test 11.2 — Verify Payout Status

Click **Mark as Paid** → Status updates to `PAID`.

---

## 📊 Phase 12 — Reports & Payslips

### Test 12.1 — View Payslip

**Where:** Sidebar → **Payslips**

1. Select **Cycle:** Acme June 2025
2. Select **Employee:** Amit Verma
3. Review payslip layout:
   - Company header (Acme Manufacturing)
   - Employee details
   - Earnings table
   - Deductions table
   - Net pay highlighted

### Test 12.2 — Download Payslip PDF

Click **Download PDF** → Verify PDF opens with correct data.

### Test 12.3 — Reports

**Where:** Sidebar → **Reports**

Generate each of these:

| Report | Filters |
|--------|---------|
| Payroll Summary Report | Client: Acme, Month: June 2025 |
| PF Report | Client: Acme, Month: June 2025 |
| ESIC Report | Client: Acme, Month: June 2025 |
| Employee Master Report | Client: Acme |

---

## 📜 Phase 13 — Audit Log

**Where:** Sidebar → **Audit Log** (visible to SUPER_ADMIN role only)

### Test 13.1 — Review Audit Trail

You should see entries for every action performed:
- `LOCATION_CREATED` — Pune Head Office
- `EMPLOYEE_CREATED` — Amit Verma
- `ATTENDANCE_LOCKED` — June 2025
- `PAYROLL_CYCLE_CREATED` — Acme June 2025

---

## 🏖️ Phase 14 — Leave Management

### Test 14.1 — Leave Policy Setup

**Where:** Sidebar → **Leave Management**

Configure leave types for Acme:

| Leave Type | Quota/Year |
|-----------|-----------|
| Earned Leave | 18 days |
| Casual Leave | 12 days |
| Sick Leave | 6 days |

### Test 14.2 — Apply Leave for Employee

**Where:** Sidebar → **Leave**

| Field | Value |
|-------|-------|
| Employee | Amit Verma |
| Leave Type | Earned Leave |
| From Date | `2025-07-10` |
| To Date | `2025-07-12` |
| Reason | Family vacation |

**Expected:** Leave request created with status `PENDING`.

### Test 14.3 — Approve Leave

Find the request → Click **Approve**.

**Expected:** Status changes to `APPROVED`. Leave balance updated: 18 → 15 days.

---

## ✅ Test Completion Checklist

| Phase | Status |
|-------|--------|
| Auth - Register & Login | ☐ |
| Create 2 Clients | ☐ |
| Add Locations | ☐ |
| Add Departments | ☐ |
| Add 3 Employees | ☐ |
| Assign Salary | ☐ |
| Mark & Lock Attendance | ☐ |
| Run Payroll (Dry + Actual) | ☐ |
| Review Compliance/PF | ☐ |
| Review TDS | ☐ |
| Generate Payouts | ☐ |
| Download Payslip PDF | ☐ |
| Generate Reports | ☐ |
| Check Audit Log | ☐ |
| Leave Management | ☐ |

---

## 🐛 Known Issues & Workarounds

| Issue | Workaround |
|-------|-----------|
| `column clients.industry does not exist` error in DB | This is a migration gap — the `industry` column needs a DB migration. The page may show an error until the migration is run. |
| `column payroll_cycles.client_id does not exist` | Same — migration needs to be run for the payroll service schema. Run alembic upgrades for each service. |

### Run Migrations (if needed)
```bash
# For each service with DB issues:
docker compose exec employee-service sh -c "cd /app && python -m alembic upgrade head"
docker compose exec client-service sh -c "cd /app && python -m alembic upgrade head"
docker compose exec payroll-service sh -c "cd /app && python -m alembic upgrade head"
```

---

## 📌 Quick Reference — Dummy Data Summary

### Login Credentials
| Role | Email | Password |
|------|-------|----------|
| Admin | `admin@nexustech.com` | `Admin@1234` |

### Clients
| Code | Name | City |
|------|------|------|
| ACME001 | Acme Manufacturing Pvt Ltd | Pune |
| INFOEDGE01 | InfoEdge Software Solutions | Bengaluru |

### Employees (Acme)
| Code | Name | Gross/Month |
|------|------|------------|
| EMP001 | Amit Verma | ₹30,000 |
| EMP002 | Sunita Patil | ₹50,000 |
| EMP003 | Ravi Nair | ₹20,000 |
