"""Payslip HTML rendering from a payroll-result breakdown_json."""

from __future__ import annotations

import datetime
from decimal import Decimal, ROUND_HALF_UP
from html import escape

from hr_shared import mask_bank_account as _mask_bank_account

def _rows(items: dict, is_bold: bool = False) -> str:
    style = "font-weight: bold;" if is_bold else ""
    return "".join(
        f"<tr><td style='{style}'>{escape(str(label))}</td>"
        f"<td class='amt' style='{style}'>{escape(str(value))}</td></tr>"
        for label, value in items.items()
    )


def _txt(value, default: str = "-") -> str:
    """Escape a value for HTML, collapsing None/blank to *default*."""
    if value is None:
        return default
    text = str(value).strip()
    return escape(text) if text else default


def _bank_account(value) -> str:
    """Payroll already masks the account in breakdown_json; masking the masked
    value again turns a missing account ("-") into a meaningless "X"."""
    text = (str(value).strip() if value else "")
    if not text or text == "-":
        return "-"
    if "X" in text.upper():
        return escape(text)
    return escape(_mask_bank_account(text))


def _company(client_info: dict | None) -> dict:
    """Pull the employing company's identity out of a client-service record.

    Every field is optional in client-service, so each line is emitted only
    when it actually has a value — a payslip must never print a placeholder
    address or statutory number as if it were real.
    """
    info = client_info or {}
    name = (info.get("client_name") or info.get("legal_name") or "").strip()
    legal_name = (info.get("legal_name") or "").strip()

    address = info.get("address") or {}
    parts = [
        address.get("line1"),
        address.get("line2"),
        address.get("area"),
        address.get("city"),
        address.get("state"),
        address.get("pincode"),
    ]
    address_line = ", ".join(escape(str(p).strip()) for p in parts if p and str(p).strip())

    ids = info.get("statutory_ids") or {}
    gstin = ids.get("gst") or ids.get("gstin") or info.get("gst_number")
    pan = ids.get("pan") or info.get("pan_number")
    id_bits = []
    if gstin:
        id_bits.append(f"GSTIN: {escape(str(gstin))}")
    if pan:
        id_bits.append(f"PAN: {escape(str(pan))}")

    return {
        "name": escape(name) if name else "Company",
        # The legal entity is only worth a second line when it differs from the
        # trading name the company is listed under.
        "legal_name": escape(legal_name) if legal_name and legal_name != name else "",
        "address": address_line,
        "ids": " &nbsp;•&nbsp; ".join(id_bits),
    }


def render_payslip_html(cycle: dict, breakdown: dict, net_pay: str, client_info: dict | None = None) -> str:
    emp = breakdown.get("employee", {})
    earnings = breakdown.get("earnings", {})
    deductions = breakdown.get("deductions", {})
    attendance = breakdown.get("attendance", {})

    gross_earnings = earnings.get("gross", "0")
    # Decimal, not float: summing the money strings as floats printed binary
    # artifacts onto the PDF (e.g. "703.7800000000001").
    total_deductions = str(
        sum((Decimal(str(deductions.get(k, "0"))) for k in deductions if k != "gross"), Decimal("0"))
        .quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    )
    
    # Exclude gross from earnings for the breakdown
    earning_rows = {
        "Basic": earnings.get("basic", "0"),
        "DA": earnings.get("da", "0"),
        "HRA": earnings.get("hra", "0"),
        "Bonus": earnings.get("bonus", "0"),
        "Special Allowance": earnings.get("special_allowance", "0"),
    }

    # Daily-rated payslips show the register-style "rate/day × paid days"
    # against each per-day component.
    if breakdown.get("wage_type") == "DAILY":
        rates = breakdown.get("daily_rates", {})
        paid_days = attendance.get("paid_days", "0")
        # The day rate is derived per cycle (monthly wage / days in month), so
        # show the divisor — it explains why the same wage gives a different
        # rate in a 30- vs 31-day month.
        dim = rates.get("days_in_month")
        for label, rate_key in (("Basic", "basic"), ("DA", "da"), ("HRA", "hra")):
            rate = rates.get(rate_key)
            if rate and float(rate) > 0 and label in earning_rows:
                suffix = f"₹{rate}/day × {paid_days} days"
                if dim:
                    suffix += f" (monthly ÷ {dim})"
                earning_rows[f"{label} ({suffix})"] = earning_rows.pop(label)
    
    deduction_rows = {
        "Provident Fund (PF)": deductions.get("employee_pf", "0"),
        "ESI": deductions.get("employee_esi", "0"),
        "Professional Tax (PT)": deductions.get("pt", "0"),
        # Half-yearly: present only in the state's contribution months.
        "Labour Welfare Fund (LWF)": deductions.get("lwf", "0"),
        "TDS": deductions.get("tds", "0"),
        "Loss of Pay (LOP)": deductions.get("lop", "0"),
        "Other": deductions.get("other", "0"),
    }

    deduction_rows = {k: v for k, v in deduction_rows.items() if float(v) > 0}
    earning_rows = {k: v for k, v in earning_rows.items() if float(v) > 0}

    generated_on = datetime.datetime.now().strftime("%d %b %Y, %I:%M %p")

    company = _company(client_info)
    company_lines = "".join(
        f"<div>{line}</div>"
        for line in (company["legal_name"], company["address"], company["ids"])
        if line
    )

    return f"""<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Payslip</title>
<style>
  body {{
    font-family: 'Inter', 'DejaVu Sans', 'Helvetica', sans-serif;
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
    /* 15% wrapped every two-word label onto a second line ("Employee
       Name", "Bank A/C No."), which is what made the box look dense.
       Dropping five fields freed the width to hold them on one line. */
    width: 21%;
    white-space: nowrap;
  }}
  .meta td.val {{
    color: #111827;
    width: 29%;
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
      <div class="logo">{company['name']}</div>
      <div class="company-info">
        {company_lines}
      </div>
    </div>
    <div class="header-right">
      <h1>PAYSLIP</h1>
      <div class="muted">For the period of <strong>{_txt(cycle.get('name'), '')}</strong></div>
      <div class="muted">{_txt(cycle.get('period_start'), '')} to {_txt(cycle.get('period_end'), '')}</div>
    </div>
  </div>

  <!--
    Kept deliberately short. Five fields came out of this box:

    Department, UAN Number and PF Number were never populated — payroll
    writes six keys into breakdown_json["employee"] (emp_code, name, pan,
    bank_account, designation, work_location) and none of those three is
    among them, so all three printed "-" on every payslip ever produced.
    pf_number had no source anywhere in the codebase at all.

    Company repeated the letterhead directly above it, and PAN was masked
    to ABCDE####F — unverifiable, and with TDS out of the project it no
    longer serves any purpose here. Neither is required on a wage slip:
    Minimum Wages (Central) Rules Form XI asks for the wage rate,
    attendance, gross, deductions and net, not identity numbers.
  -->
  <div class="emp-box">
    <table class="meta">
      <tr>
        <td class="lbl">Employee Name</td><td class="val">{_txt(emp.get('name'))}</td>
        <td class="lbl">Employee ID</td><td class="val">{_txt(emp.get('emp_code'))}</td>
      </tr>
      <tr>
        <td class="lbl">Designation</td><td class="val">{_txt(emp.get('designation'))}</td>
        <td class="lbl">Work Location</td><td class="val">{_txt(emp.get('work_location'))}</td>
      </tr>
      <tr>
        <td class="lbl">Total Days</td><td class="val">{_txt(attendance.get('total_days'))}</td>
        <td class="lbl">Payable Days</td><td class="val">{_txt(attendance.get('payable_days', attendance.get('paid_days')))} (LOP: {_txt(attendance.get('lop_days'), '0')})</td>
      </tr>
      <!-- Seven fields into a two-column grid leaves one cell over. It trails
           the last row so the pairs above stay intact — splitting Total and
           Payable Days across rows would be worse than an empty cell. The
           cells carry no borders, so the gap does not render. -->
      <tr>
        <td class="lbl">Bank A/C No.</td><td class="val">{_bank_account(emp.get('bank_account'))}</td>
        <td class="lbl">UAN No.</td><td class="val">{_txt(emp.get('uan_number'))}</td>
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
    <p>Generated on {generated_on} via HRMS.</p>
  </div>

</body>
</html>"""
