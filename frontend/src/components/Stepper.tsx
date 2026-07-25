import clsx from "clsx";
import type { CycleStatus } from "../types";

const STEPS: CycleStatus[] = [
  "DRAFT",
  "LOCKED",
  "COMPUTING",
  "COMPUTED",
  "APPROVED",
  "DISBURSED",
];

export function Stepper({ status }: { status: CycleStatus }) {
  const isFailed = status === "FAILED";
  const currentIdx = STEPS.indexOf(status);

  return (
    <div className="flex items-center" role="list" aria-label="Payroll cycle progress">
      {STEPS.map((step, i) => {
        const done = isFailed ? false : i < currentIdx;
        const active = !isFailed && i === currentIdx;
        const failed = isFailed && i === currentIdx;

        return (
          <div key={step} className="flex items-center flex-1 last:flex-none" role="listitem">
            <div className="flex flex-col items-center">
              <div
                className={clsx(
                  "flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold transition-colors",
                  {
                    "bg-indigo-600 text-white": done,
                    "bg-indigo-100 text-indigo-600 ring-2 ring-indigo-600": active,
                    "bg-red-100 text-red-600 ring-2 ring-red-500": failed,
                    "bg-gray-100 text-gray-400": !done && !active && !failed,
                  }
                )}
                aria-current={active ? "step" : undefined}
              >
                {done ? "✓" : i + 1}
              </div>
              <div
                className={clsx("mt-1 text-[10px] font-medium", {
                  "text-indigo-600": done || active,
                  "text-red-600": failed,
                  "text-gray-400": !done && !active && !failed,
                })}
              >
                {step === "FAILED" ? "FAILED" : step}
              </div>
            </div>
            {i < STEPS.length - 1 && (
              <div
                className={clsx("mx-1 h-0.5 flex-1", {
                  "bg-indigo-600": done,
                  "bg-gray-200": !done,
                })}
              />
            )}
          </div>
        );
      })}
      {isFailed && (
        <div className="ml-4 rounded-full bg-red-100 px-3 py-1 text-xs font-semibold text-red-700">
          FAILED
        </div>
      )}
    </div>
  );
}
