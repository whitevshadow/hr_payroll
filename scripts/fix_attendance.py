"""
Fix Attendance.tsx by replacing the broken return block
"""
import os
import re

path = r'd:\hr_payroll-develop__anish\frontend\src\pages\Attendance.tsx'

with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

# The render block starts at '  // -- Render'
render_marker = '  // \u2500\u2500 Render \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500'
render_start = content.find(render_marker)
if render_start == -1:
    # Try shorter version
    render_marker = '  // \u2500\u2500 Render'
    render_start = content.find(render_marker)

if render_start == -1:
    print("ERROR: Could not find render marker")
    exit(1)

print(f"Render block starts at: {render_start}")

# Find the closing of the AttendancePage function
# It ends just before the next top-level function definition
# Look for "\nfunction " that starts a new function
next_func = re.search(r'\n(function |const |export function )', content[render_start + 100:])
if next_func:
    func_end = render_start + 100 + next_func.start()
else:
    func_end = len(content)

print(f"Function ends at: {func_end}")

before = content[:render_start]
after = content[func_end:]

new_render = '''  // \u2500\u2500 Render \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  return (
    <div className="space-y-5">
      <PageHeader
        title="Attendance Management"
        subtitle="Monthly attendance entry, validation, and payroll locking"
      >
        {/* Toolbar \u2014 only shown when a client is selected */}
        {selectedClientId && (
          <div className="flex items-center gap-2 flex-wrap">
            {/* Month picker */}
            <div className="relative">
              <Calendar className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--text-muted)]" />
              <input
                type="month"
                value={month}
                onChange={(e) => { setMonth(e.target.value); setGridLoaded(false); }}
                className="input pl-8 text-sm py-2 w-40"
              />
            </div>

            {/* Status badge */}
            <StatusBadge status={status} />

            {canEdit && (
              <>
                <button onClick={downloadTemplate} className="btn-ghost flex items-center gap-1.5 text-sm py-2 px-3 rounded-xl">
                  <Download className="h-3.5 w-3.5" /> Template
                </button>
                <button onClick={() => fileInputRef.current?.click()} className="btn-ghost flex items-center gap-1.5 text-sm py-2 px-3 rounded-xl">
                  <Upload className="h-3.5 w-3.5" /> Import Excel
                </button>
                <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleFileUpload} />
              </>
            )}

            {canEdit && status === "DRAFT" && (
              <button onClick={() => setShowValidate(true)} className="btn-ghost flex items-center gap-1.5 text-sm py-2 px-3 rounded-xl text-blue-600">
                <CheckCircle2 className="h-3.5 w-3.5" /> Validate
              </button>
            )}

            {canEdit && (
              <button
                onClick={() => setShowLock(true)}
                className="flex items-center gap-1.5 rounded-xl bg-red-600 hover:bg-red-700 text-white px-3 py-2 text-sm font-semibold transition-colors"
              >
                <Lock className="h-3.5 w-3.5" /> Lock Attendance
              </button>
            )}

            {isLocked && isAdmin && (
              <button
                onClick={() => setShowUnlock(true)}
                className="flex items-center gap-1.5 rounded-xl border border-amber-400 text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20 px-3 py-2 text-sm font-semibold transition-colors"
              >
                <Unlock className="h-3.5 w-3.5" /> Unlock
              </button>
            )}
          </div>
        )}
      </PageHeader>

      {!selectedClientId ? (
        <div className="card-glass p-12 flex flex-col items-center justify-center text-center">
          <Users className="h-12 w-12 text-slate-300 mb-4" />
          <h2 className="text-lg font-bold text-slate-800">No Client Selected</h2>
          <p className="text-slate-500 mt-2 max-w-sm">Please select a client from the top navigation bar to view or manage attendance.</p>
        </div>
      ) : (
        <>
          {/* \u2500\u2500 Locked banner \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */}
          <AnimatePresence>
'''

# Now we need to find the original content from the AnimatePresence locked banner onwards
# and use that, up to but not including the broken close at the end
anim_marker = '      <AnimatePresence>\r\n        {isLocked && ('
anim_start = content.find(anim_marker)
if anim_start == -1:
    anim_marker = '      <AnimatePresence>\n        {isLocked && ('
    anim_start = content.find(anim_marker)

if anim_start == -1:
    print("ERROR: Could not find AnimatePresence locked banner")
    exit(1)

print(f"AnimatePresence starts at: {anim_start}")

# Get everything from AnimatePresence to the broken end, then fix the end
original_middle = content[anim_start:func_end]

# The end is currently:
# ...
#         )}
#         )}        <--- extra one from our bad edit
#       </AnimatePresence>
#     </div>
#       </>
#       )}
#   );
# }
# 
# We need to remove the duplicate )} and fix the closing structure
# Replace the broken end with correct one
broken_end = '        )}\r\n        )}\r\n      </AnimatePresence>\r\n    </div>\r\n      </>\r\n      )}\r\n  );\r\n}\r\n'
correct_end = '        )}\r\n      </AnimatePresence>\r\n        </>\r\n      )}\r\n    </div>\r\n  );\r\n}\r\n'

if broken_end in original_middle:
    original_middle = original_middle.replace(broken_end, correct_end)
    print("Fixed broken end pattern (CRLF)")
else:
    # Try LF version
    broken_end_lf = '        )}\n        )}\n      </AnimatePresence>\n    </div>\n      </>\n      )}\n  );\n}\n'
    correct_end_lf = '        )}\n      </AnimatePresence>\n        </>\n      )}\n    </div>\n  );\n}\n'
    if broken_end_lf in original_middle:
        original_middle = original_middle.replace(broken_end_lf, correct_end_lf)
        print("Fixed broken end pattern (LF)")
    else:
        print("WARNING: Could not find broken end pattern - showing last 200 chars:")
        print(repr(original_middle[-200:]))

new_content = before + new_render + original_middle
with open(path, 'w', encoding='utf-8') as f:
    f.write(new_content)

print(f"Attendance.tsx rewritten. Total chars: {len(new_content)}")
