import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="max-w-sm">
        <h1 className="mb-1.5 font-mono text-body text-muted">404</h1>
        <p className="mb-4 text-callout text-paper">That page doesn&apos;t exist.</p>
        <Link href="/dashboard" className="text-body text-signal hover:underline">
          Back to your dashboard
        </Link>
      </div>
    </main>
  );
}
