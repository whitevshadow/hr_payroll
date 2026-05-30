"""Payslip HTML rendering from a payroll-result breakdown_json."""

from __future__ import annotations


def _rows(items: dict) -> str:
    return "".join(
        f"<tr><td>{label}</td><td class='amt'>{value}</td></tr>"
        for label, value in items.items()
    )


def render_payslip_html(cycle: dict, breakdown: dict, net_pay: str) -> str:
    emp = breakdown.get("employee", {})
    earnings = breakdown.get("earnings", {})
    deductions = breakdown.get("deductions", {})
    attendance = breakdown.get("attendance", {})

    earning_rows = {
        "Basic": earnings.get("basic", "0"),
        "HRA": earnings.get("hra", "0"),
        "Special Allowance": earnings.get("special_allowance", "0"),
        "Gross Earnings": earnings.get("gross", "0"),
    }
    deduction_rows = {
        "Provident Fund (PF)": deductions.get("employee_pf", "0"),
        "ESI": deductions.get("employee_esi", "0"),
        "Professional Tax (PT)": deductions.get("pt", "0"),
        "TDS": deductions.get("tds", "0"),
        "Loss of Pay (LOP)": deductions.get("lop", "0"),
        "Other": deductions.get("other", "0"),
    }

    return f"""<!doctype html>
<html><head><meta charset="utf-8"><title>Payslip</title>
<style>
  body {{ font-family: Arial, Helvetica, sans-serif; color: #1f2937; margin: 24px; }}
  h1 {{ font-size: 20px; margin-bottom: 0; }}
  .muted {{ color: #6b7280; font-size: 12px; }}
  table {{ width: 100%; border-collapse: collapse; margin-top: 12px; }}
  th, td {{ text-align: left; padding: 6px 8px; border-bottom: 1px solid #e5e7eb; font-size: 13px; }}
  th {{ background: #f3f4f6; }}
  .amt {{ text-align: right; font-variant-numeric: tabular-nums; }}
  .cols {{ display: flex; gap: 24px; }}
  .col {{ flex: 1; }}
  .net {{ margin-top: 16px; padding: 12px; background: #eef2ff; border-radius: 8px;
          font-size: 16px; font-weight: bold; }}
  .meta td {{ border: none; padding: 2px 8px; }}
</style></head>
<body>
  <h1>Payslip</h1>
  <div class="muted">{cycle.get('name', '')} &middot; {cycle.get('period_start', '')} to {cycle.get('period_end', '')}</div>
  <table class="meta">
    <tr><td><b>Employee</b></td><td>{emp.get('name', '')} ({emp.get('emp_code', '')})</td>
        <td><b>Designation</b></td><td>{emp.get('designation', '') or '-'}</td></tr>
    <tr><td><b>PAN</b></td><td>{emp.get('pan', '') or '-'}</td>
        <td><b>Location</b></td><td>{emp.get('work_location', '') or '-'}</td></tr>
    <tr><td><b>Days</b></td><td>Total {attendance.get('total_days', '-')},
        Payable {attendance.get('payable_days', '-')}, LOP {attendance.get('lop_days', '-')}</td>
        <td><b>Bank A/C</b></td><td>{emp.get('bank_account', '') or '-'}</td></tr>
  </table>
  <div class="cols">
    <div class="col">
      <table><thead><tr><th>Earnings</th><th class="amt">Amount</th></tr></thead>
        <tbody>{_rows(earning_rows)}</tbody></table>
    </div>
    <div class="col">
      <table><thead><tr><th>Deductions</th><th class="amt">Amount</th></tr></thead>
        <tbody>{_rows(deduction_rows)}</tbody></table>
    </div>
  </div>
  <div class="net">Net Pay: ₹ {net_pay}</div>
  <p class="muted">This is a system-generated payslip (V1, simulated payout).</p>
</body></html>"""
