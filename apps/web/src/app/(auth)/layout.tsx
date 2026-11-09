export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-4 py-10">
      <div className="mb-8 text-center">
        <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-lg font-bold text-primary-foreground" aria-hidden>
          E
        </div>
        <h1 className="text-xl font-semibold">EduNex ERP</h1>
        <p className="text-sm text-muted-foreground">School Management. Simplified.</p>
      </div>
      {children}
      <p className="mt-8 text-center text-xs text-muted-foreground">Demo / development build — use synthetic data only.</p>
    </main>
  );
}
