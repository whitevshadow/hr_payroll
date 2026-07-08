"""Payslip HTML rendering from a payroll-result breakdown_json."""

from __future__ import annotations

import datetime

from hr_shared import mask_bank_account as _mask_bank_account

def _rows(items: dict, is_bold: bool = False) -> str:
    style = "font-weight: bold;" if is_bold else ""
    return "".join(
        f"<tr><td style='{style}'>{label}</td><td class='amt' style='{style}'>{value}</td></tr>"
        for label, value in items.items()
    )

def render_payslip_html(cycle: dict, breakdown: dict, net_pay: str) -> str:
    emp = breakdown.get("employee", {})
    earnings = breakdown.get("earnings", {})
    deductions = breakdown.get("deductions", {})
    attendance = breakdown.get("attendance", {})

    gross_earnings = earnings.get("gross", "0")
    total_deductions = str(
        sum(float(deductions.get(k, "0")) for k in deductions if k != "gross")
    )
    
    # Exclude gross from earnings for the breakdown
    earning_rows = {
        "Basic": earnings.get("basic", "0"),
        "HRA": earnings.get("hra", "0"),
        "Special Allowance": earnings.get("special_allowance", "0"),
    }
    
    deduction_rows = {
        "Provident Fund (PF)": deductions.get("employee_pf", "0"),
        "ESI": deductions.get("employee_esi", "0"),
        "Professional Tax (PT)": deductions.get("pt", "0"),
        "TDS": deductions.get("tds", "0"),
        "Loss of Pay (LOP)": deductions.get("lop", "0"),
        "Other": deductions.get("other", "0"),
    }

    # Remove zero value deductions to make it cleaner
    deduction_rows = {k: v for k, v in deduction_rows.items() if float(v) > 0}
    earning_rows = {k: v for k, v in earning_rows.items() if float(v) > 0}

    generated_on = datetime.datetime.now().strftime("%d %b %Y, %I:%M %p")

    return f"""<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Payslip</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
  
  body {{ 
    font-family: 'Inter', sans-serif; 
    color: #1f2937; 
    margin: 40px; 
    font-size: 13px;
    background-color: #ffffff;
  }}
  .header {{
    display: table;
    width: 100%;
    margin-bottom: 20px;
    border-bottom: 2px solid #e5e7eb;
    padding-bottom: 20px;
  }}
  .header-left {{
    display: table-cell;
    vertical-align: middle;
  }}
  .header-right {{
    display: table-cell;
    vertical-align: middle;
    text-align: right;
  }}
  .logo {{
    font-size: 24px;
    font-weight: 800;
    color: #4f46e5; /* Indigo 600 */
    letter-spacing: -0.5px;
  }}
  .company-info {{
    font-size: 11px;
    color: #6b7280;
    margin-top: 4px;
    line-height: 1.4;
  }}
  h1 {{ 
    font-size: 22px; 
    font-weight: 700;
    margin: 0 0 5px 0; 
    color: #111827;
  }}
  .muted {{ 
    color: #6b7280; 
    font-size: 13px; 
  }}
  .emp-box {{
    background: #f9fafb;
    border: 1px solid #e5e7eb;
    border-radius: 6px;
    padding: 16px;
    margin-bottom: 24px;
  }}
  .meta {{
    width: 100%;
    border-collapse: collapse;
  }}
  .meta td {{ 
    padding: 6px 4px;
    font-size: 12px;
  }}
  .meta td.lbl {{
    font-weight: 600;
    color: #4b5563;
    width: 15%;
  }}
  .meta td.val {{
    color: #111827;
    width: 35%;
  }}
  .tables-container {{
    display: table;
    width: 100%;
    table-layout: fixed;
    margin-bottom: 24px;
  }}
  .table-wrapper {{
    display: table-cell;
    width: 50%;
  }}
  .table-wrapper.left {{
    padding-right: 12px;
  }}
  .table-wrapper.right {{
    padding-left: 12px;
  }}
  .data-table {{ 
    width: 100%; 
    border-collapse: collapse;
    border: 1px solid #e5e7eb;
  }}
  .data-table th, .data-table td {{ 
    text-align: left; 
    padding: 10px 12px; 
    border-bottom: 1px solid #e5e7eb; 
  }}
  .data-table th {{ 
    background: #f3f4f6; 
    font-weight: 600;
    color: #374151;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }}
  .data-table td {{
    font-size: 13px;
  }}
  .amt {{ 
    text-align: right !important; 
    font-variant-numeric: tabular-nums; 
  }}
  .net-box {{ 
    padding: 20px; 
    background: #eef2ff; 
    border-radius: 8px;
    border: 1px solid #c7d2fe;
    text-align: right;
    margin-bottom: 40px;
  }}
  .net-label {{
    font-size: 14px;
    color: #4338ca;
    font-weight: 600;
    margin-bottom: 4px;
  }}
  .net-value {{
    font-size: 28px;
    font-weight: 800;
    color: #312e81;
    font-variant-numeric: tabular-nums;
  }}
  .net-words {{
    font-size: 12px;
    color: #4f46e5;
    margin-top: 4px;
    font-weight: 500;
  }}
  .footer {{
    text-align: center;
    border-top: 1px solid #e5e7eb;
    padding-top: 20px;
    font-size: 11px;
    color: #9ca3af;
  }}
</style>
</head>
<body>
  <div class="header">
    <div class="header-left">
      <!-- You can replace this text with an <img src="..."> if you have a logo URL -->
      <div class="logo">ACME Corp Ltd.</div>
      <div class="company-info">
        123 Tech Park, Suite 400, Innovation Blvd<br>
        Bangalore, Karnataka 560001, India<br>
        GSTIN: 29XXXXXXXXXXXXX | info@acmecorp.com
      </div>
    </div>
    <div class="header-right">
      <h1>PAYSLIP</h1>
      <div class="muted">For the period of <strong>{cycle.get('name', '')}</strong></div>
      <div class="muted">{cycle.get('period_start', '')} to {cycle.get('period_end', '')}</div>
    </div>
  </div>

  <div class="emp-box">
    <table class="meta">
      <tr>
        <td class="lbl">Employee Name</td><td class="val">{emp.get('name', '')}</td>
        <td class="lbl">Employee ID</td><td class="val">{emp.get('emp_code', '')}</td>
      </tr>
      <tr>
        <td class="lbl">Designation</td><td class="val">{emp.get('designation', '') or '-'}</td>
        <td class="lbl">Department</td><td class="val">{emp.get('department', '') or '-'}</td>
      </tr>
      <tr>
        <td class="lbl">PAN Number</td><td class="val">{emp.get('pan', '') or '-'}</td>
        <td class="lbl">Bank A/C No.</td><td class="val">{_mask_bank_account(emp.get('bank_account'))}</td>
      </tr>
      <tr>
        <td class="lbl">UAN Number</td><td class="val">{emp.get('uan', '') or '-'}</td>
        <td class="lbl">PF Number</td><td class="val">{emp.get('pf_number', '') or '-'}</td>
      </tr>
      <tr>
        <td class="lbl">Total Days</td><td class="val">{attendance.get('total_days', '-')}</td>
        <td class="lbl">Payable Days</td><td class="val">{attendance.get('payable_days', '-')} (LOP: {attendance.get('lop_days', '0')})</td>
      </tr>
    </table>
  </div>

  <div class="tables-container">
    <div class="table-wrapper left">
      <table class="data-table">
        <thead>
          <tr>
            <th>Earnings</th>
            <th class="amt">Amount (₹)</th>
          </tr>
        </thead>
        <tbody>
          {_rows(earning_rows)}
          {_rows({"Gross Earnings": gross_earnings}, is_bold=True)}
        </tbody>
      </table>
    </div>
    <div class="table-wrapper right">
      <table class="data-table">
        <thead>
          <tr>
            <th>Deductions</th>
            <th class="amt">Amount (₹)</th>
          </tr>
        </thead>
        <tbody>
          {_rows(deduction_rows) if deduction_rows else "<tr><td colspan='2' style='color:#9ca3af; text-align:center;'>No deductions</td></tr>"}
          {_rows({"Total Deductions": total_deductions}, is_bold=True)}
        </tbody>
      </table>
    </div>
  </div>

  <div class="net-box">
    <div class="net-label">Net Payable Amount</div>
    <div class="net-value">₹ {net_pay}</div>
    <!-- <div class="net-words">Rupees Fifty Thousand Only</div> -->
  </div>

  <div class="footer">
    <p>This is a computer-generated document and does not require a signature.</p>
    <p>Generated on {generated_on} via ACME HRMS.</p>
  </div>

</body>
</html>"""
