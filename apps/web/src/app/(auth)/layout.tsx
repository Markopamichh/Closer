import type { ReactNode } from "react";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-muted/40 px-4">
      <div className="mb-8 flex items-center gap-2 text-lg font-semibold tracking-tight">
        <span className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
          C
        </span>
        Closer
      </div>
      <div className="w-full max-w-sm">{children}</div>
    </main>
  );
}
