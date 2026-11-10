/** Shown on every page of a PUBLIC DEMO deployment (build flag NEXT_PUBLIC_DEMO_MODE=true). Absent from normal builds. */
export function DemoBanner() {
  if (process.env.NEXT_PUBLIC_DEMO_MODE !== 'true') return null;
  return (
    <div role="note" className="px-3 py-1.5 text-center text-xs font-semibold print:hidden" style={{ background: '#fde68a', color: '#1c1917' }} data-testid="demo-banner">
      DEMO — all data is fake. Do not enter real student, parent or staff information.
    </div>
  );
}
