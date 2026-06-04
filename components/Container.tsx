// The standard content width for the app's reading-width pages. Defined once
// here so the width is a single edit (the admin board deliberately opts out by
// not using this wrapper — it wants full width for the Kanban columns).
export function Container({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto max-w-4xl">{children}</div>;
}
