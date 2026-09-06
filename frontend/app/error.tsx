'use client';

// Global React error boundary (platform spec §4.7's production-readiness
// list). Next.js renders this whenever a client component below it throws.
export default function GlobalError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="max-w-md">
        <p className="mb-1.5 text-callout text-paper">Something broke while rendering this page.</p>
        <p className="mb-4 font-mono text-subhead leading-relaxed text-muted">{error.message}</p>
        <button onClick={reset} className="border border-line px-3 py-1.5 text-body text-paper hover:border-signal">
          Try again
        </button>
      </div>
    </main>
  );
}
