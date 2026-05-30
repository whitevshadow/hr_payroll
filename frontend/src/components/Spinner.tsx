import clsx from "clsx";

export function Spinner({ className }: { className?: string }) {
  return (
    <div
      className={clsx(
        "inline-block animate-spin rounded-full border-2 border-slate-200 border-t-accent-600 dark:border-slate-700 dark:border-t-accent-400",
        className ?? "h-5 w-5"
      )}
      aria-hidden="true"
    />
  );
}

export function FullPageSpinner() {
  return (
    <div className="flex h-full min-h-[200px] items-center justify-center">
      <Spinner className="h-8 w-8" />
    </div>
  );
}

export function SkeletonRow({ cols = 4 }: { cols?: number }) {
  return (
    <tr>
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i} className="px-4 py-3">
          <div
            className="h-4 rounded-md skeleton"
            style={{ width: `${60 + (i % 3) * 20}%` }}
          />
        </td>
      ))}
    </tr>
  );
}

export function Skeleton({
  className,
}: {
  className?: string;
}) {
  return <div className={clsx("skeleton rounded-md", className ?? "h-4 w-full")} />;
}
