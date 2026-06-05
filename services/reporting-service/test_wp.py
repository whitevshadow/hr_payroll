from weasyprint import HTML
html = "<html><body><h1>Test Payslip</h1><p>This is a test.</p></body></html>"
pdf_bytes = HTML(string=html).write_pdf()
with open("/app/test_weasyprint.pdf", "wb") as f:
    f.write(pdf_bytes)
print("Saved 1")
