import os

salary_path = r'd:\hr_payroll-develop__anish\frontend\src\pages\Salary.tsx'

with open(salary_path, 'r', encoding='utf-8') as f:
    content = f.read()

# Find the start of return (
return_start = content.find('\n  return (')
if return_start == -1:
    print("ERROR: Could not find 'return (' in Salary.tsx")
    exit(1)

# Find the end of the Salary function (the first standalone '}' after 'return')
# We'll look for the pattern: the closing of the Salary() function
# which is '}\n\nfunction TemplateModal'
func_end = content.find('\nfunction TemplateModal')
if func_end == -1:
    print("ERROR: Could not find TemplateModal function boundary")
    exit(1)

print(f"Return block starts at char: {return_start}")
print(f"Function ends at char: {func_end}")

before = content[:return_start]
after = content[func_end:]

new_return = '''
  return (
    <div>
      <PageHeader
        title="Salary Management"
        subtitle="Manage employee salary structures and payroll templates"
      />

      <div className="flex items-center gap-1 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 p-1 w-fit mb-6">
        <button
          onClick={() => setActiveTab("salaries")}
          className={clsx("flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition-colors", activeTab === "salaries" ? "bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm border border-slate-200 dark:border-slate-700" : "text-slate-500 hover:text-slate-700")}
        >
          <DollarSign className="h-4 w-4" /> Employee Salaries
        </button>
        <button
          onClick={() => setActiveTab("templates")}
          className={clsx("flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition-colors", activeTab === "templates" ? "bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm border border-slate-200 dark:border-slate-700" : "text-slate-500 hover:text-slate-700")}
        >
          <Settings className="h-4 w-4" /> Salary Templates
        </button>
      </div>

      {activeTab === "salaries" && (
        <div className="space-y-6">
          <div className="mb-6 flex flex-col sm:flex-row gap-4 max-w-2xl">
            <div className="flex-1">
              <label className="label" htmlFor="client-sel">Select Client</label>
              <select
                id="client-sel"
                className="input"
                value={selectedClientId || ""}
                onChange={(e) => {
                  setSelectedClientId(e.target.value || null);
                  setSelectedEmpId("");
                  setCtc("");
                }}
              >
                <option value="">All Clients</option>
                {clientsQ.data?.items.map((c) => (
                  <option key={c.id} value={c.id}>{c.client_name}</option>
                ))}
              </select>
            </div>
            <div className="flex-1">
              <label className="label" htmlFor="emp-sel">Select Employee</label>
              <select
                id="emp-sel"
                className="input"
                value={selectedEmpId}
                onChange={(e) => { setSelectedEmpId(e.target.value); setCtc(""); }}
              >
                <option value="">Choose an employee\u2026</option>
                {employees.data?.items.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.emp_code} \u2014 {e.first_name} {e.last_name} ({e.work_location ?? "?"})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {selectedEmpId && (
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
              <div className="card">
                <div className="mb-4 flex items-center gap-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 dark:bg-emerald-900/30">
                    <DollarSign className="h-4 w-4 text-emerald-600" />
                  </div>
                  <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">Active Structure</h2>
                </div>
                {structure.isLoading && <FullPageSpinner />}
                {structure.isError && (
                  <div className="flex h-32 items-center justify-center text-sm text-slate-400">
                    No active salary structure yet.
                  </div>
                )}
                {structure.data && (
                  <>
                    <div className="space-y-2">
                      {[
                        { label: "Annual CTC", value: structure.data.ctc, highlight: true },
                        { label: "Monthly Gross", value: structure.data.breakdown.monthly_gross },
                        { label: "Basic (40%)", value: structure.data.breakdown.basic, indent: true },
                        {
                          label: `HRA (${structure.data.breakdown.is_metro ? "Metro 50%" : "Non-Metro 40%"})`,
                          value: structure.data.breakdown.hra,
                          indent: true,
                        },
                        { label: "Special Allowance", value: structure.data.breakdown.special_allowance, indent: true },
                      ].map((row) => (
                        <div
                          key={row.label}
                          className={clsx(
                            "flex items-center justify-between rounded-lg px-3 py-2",
                            row.highlight ? "bg-accent-50 dark:bg-accent-900/20" : row.indent ? "bg-slate-50/50 dark:bg-slate-800/30 ml-3" : ""
                          )}
                        >
                          <span className={clsx("text-sm", row.indent ? "text-slate-500 dark:text-slate-400" : "text-slate-700 dark:text-slate-300")}>{row.label}</span>
                          <span className={clsx("text-sm font-numeric font-semibold", row.highlight ? "text-accent-700 dark:text-accent-400" : "text-slate-800 dark:text-slate-200")}>{formatINR(row.value)}</span>
                        </div>
                      ))}
                    </div>
                    <p className="mt-3 text-xs text-slate-400 dark:text-slate-500">
                      Effective from {formatDate(structure.data.effective_from)}
                    </p>
                  </>
                )}
              </div>

              <div className="card">
                <div className="mb-4 flex items-center gap-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-50 dark:bg-accent-900/30">
                    {structure.data ? <RefreshCw className="h-4 w-4 text-accent-600" /> : <Calculator className="h-4 w-4 text-accent-600" />}
                  </div>
                  <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                    {structure.data ? "Revise Structure" : "Create Structure"}
                  </h2>
                </div>
                <div className="space-y-4">
                  <div>
                    <label className="label" htmlFor="ctc-input">Annual CTC (\u20b9)</label>
                    <input id="ctc-input" className="input" type="number" min="0" step="1000" value={ctc} onChange={(e) => setCtc(e.target.value)} placeholder="e.g. 1200000" />
                  </div>
                  <div>
                    <label className="label" htmlFor="eff-input">Effective From</label>
                    <input id="eff-input" className="input" type="date" value={effFrom} onChange={(e) => setEffFrom(e.target.value)} />
                  </div>
                  {preview && (
                    <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="rounded-xl border border-accent-100 dark:border-accent-900/30 bg-accent-50/50 dark:bg-accent-900/10 p-4">
                      <div className="mb-3 flex items-center gap-2">
                        <TrendingUp className="h-3.5 w-3.5 text-accent-600 dark:text-accent-400" />
                        <div className="text-xs font-semibold uppercase tracking-wide text-accent-600 dark:text-accent-400">Live Preview \u2014 {preview.isMetro ? "Metro" : "Non-Metro"}</div>
                      </div>
                      <div className="space-y-2">
                        {[["Monthly Gross", preview.monthlyGross], ["Basic (40%)", preview.basic], [`HRA (${preview.isMetro ? "50%" : "40%"})`, preview.hra], ["Special Allowance", preview.specialAllowance]].map(([label, val]) => (
                          <div key={label as string} className="flex items-center justify-between">
                            <span className="text-xs text-accent-700 dark:text-accent-300">{label}</span>
                            <span className="text-xs font-numeric font-semibold text-accent-800 dark:text-accent-200">{formatINR(val as number)}</span>
                          </div>
                        ))}
                      </div>
                      <p className="mt-2 text-[10px] text-accent-400 dark:text-accent-600">Preview only \u2014 server-authoritative values shown after save</p>
                    </motion.div>
                  )}
                  {formError && <div className="alert-danger">{formError}</div>}
                  <button className="btn w-full" disabled={!ctc || saveMut.isPending} onClick={() => saveMut.mutate()}>
                    {saveMut.isPending ? <><span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" /> Saving\u2026</> : structure.data ? "Revise Structure" : "Create Structure"}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === "templates" && (
        <div className="space-y-6">
          <div className="flex justify-between items-center">
            <div className="flex-1 max-w-sm">
              <label className="label" htmlFor="tpl-client-sel">Client Filter</label>
              <select id="tpl-client-sel" className="input h-9 text-sm py-1.5" value={selectedClientId || ""} onChange={(e) => setSelectedClientId(e.target.value || null)}>
                <option value="">Global / Internal Templates</option>
                {clientsQ.data?.items.map((c) => <option key={c.id} value={c.id}>{c.client_name}</option>)}
              </select>
            </div>
            <button className="btn mt-6" onClick={() => setShowTemplateModal(true)}>
              <Plus className="h-4 w-4" /> New Template
            </button>
          </div>
          {templatesQ.isLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {Array.from({ length: 3 }).map((_, i) => <div key={i} className="card h-40 animate-pulse bg-slate-50" />)}
            </div>
          ) : templatesQ.data?.length === 0 ? (
            <div className="card text-center py-10 text-slate-500">No salary templates configured.</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {templatesQ.data?.map(tpl => (
                <div key={tpl.id} className="card p-5 border-t-4 border-t-emerald-500">
                  <div className="flex justify-between items-start mb-2">
                    <h3 className="font-bold text-slate-900 dark:text-white">{tpl.template_name}</h3>
                    {tpl.is_active && <span className="bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full text-[10px] font-bold">ACTIVE</span>}
                  </div>
                  <p className="text-sm text-slate-500 mb-4 h-10">{tpl.description || "Standard salary structure"}</p>
                  <div className="bg-slate-50 dark:bg-slate-800/50 p-3 rounded-lg space-y-2">
                    <div className="text-xs font-semibold text-slate-600 mb-2">Components:</div>
                    {tpl.template_components.map((c: any, i: number) => (
                      <div key={i} className="flex justify-between text-xs">
                        <span className="text-slate-500">{c.component_name}</span>
                        <span className="font-medium text-slate-700">{c.calculation_type === "PERCENTAGE_OF_BASIC" ? `${c.value}% Basic` : c.calculation_type === "PERCENTAGE_OF_CTC" ? `${c.value}% CTC` : `\u20b9${c.value}`}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {showTemplateModal && <TemplateModal clientId={selectedClientId} onClose={() => setShowTemplateModal(false)} />}
    </div>
  );
}
'''

new_content = before + new_return + after
with open(salary_path, 'w', encoding='utf-8') as f:
    f.write(new_content)

print("Salary.tsx return block rewritten successfully.")
print(f"New total chars: {len(new_content)}")
