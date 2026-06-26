export default function RadarLoading() {
  return (
    <div className="flex flex-col gap-4">
      {/* Slim top loading bar that preserves nav visibility */}
      <div className="h-0.5 w-full overflow-hidden rounded-full bg-[var(--ci-border)]">
        <div className="h-full w-1/3 animate-[loading-bar_1.2s_ease-in-out_infinite] rounded-full bg-[var(--ci-accent)]" />
      </div>
      {/* Content skeleton */}
      <div className="rounded-xl border border-[var(--ci-border)] bg-white p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-4 w-1/4 rounded bg-slate-100" />
          <div className="h-3 w-2/3 rounded bg-slate-100" />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-20 rounded-xl bg-slate-100" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
