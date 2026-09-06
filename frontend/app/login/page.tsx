'use client';
import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { TrendingUp, Sparkles, ShieldCheck } from 'lucide-react';
import { api, setToken } from '../../lib/apiClient';
import { Button, InlineAlert } from '../../components/ui';

const POINTS = [
  { icon: Sparkles, title: 'Ask in plain language', body: 'Questions become real queries, with the charts built from the rows that came back.' },
  { icon: TrendingUp, title: 'Findings, not tables', body: 'Efficiency spread, spend and return diverging, collection gaps — computed, not guessed.' },
  { icon: ShieldCheck, title: 'Every figure traceable', body: 'Each answer links to the exact rows behind it, so nothing has to be taken on trust.' },
];

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get('next') || '/dashboard';

  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const result = mode === 'login' ? await api.login(email, password) : await api.signup(email, password, name);
      setToken(result.token);
      // New accounts go through role selection first: it shapes every AI
      // answer afterwards, and asking later means the early answers are worse.
      router.push(mode === 'signup' ? `/onboarding?next=${encodeURIComponent(next)}` : next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  const field =
    'w-full rounded-sm border border-line bg-sunken px-3.5 py-2.5 text-body outline-none transition-colors focus:border-accent focus:bg-card';

  return (
    <main className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      {/* Left: the pitch. A login page is the first impression of the
          product, and a bare form on grey says nothing about it. */}
      <section className="relative hidden flex-col justify-between overflow-hidden bg-invert-panel p-12 text-on-invert-panel lg:flex">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-24 -top-24 h-[420px] w-[420px] rounded-full opacity-40 blur-3xl"
          style={{ background: 'radial-gradient(circle, rgb(var(--accent)) 0%, transparent 70%)' }}
        />
        <div className="relative flex items-center gap-2.5">
          <span className="grid h-8 w-8 place-items-center rounded-sm bg-accent text-callout font-bold text-on-accent">P</span>
          <span className="text-callout font-semibold tracking-tight">Prism</span>
        </div>

        <div className="relative max-w-md">
          <h1 className="text-display leading-[1.12]">
            Your analytics, <span className="text-accent">answered</span>.
          </h1>
          <p className="mt-4 text-callout leading-relaxed text-on-invert-panel/70">
            Connect GA4 and your ad platforms, then ask questions the way you'd ask a colleague.
          </p>

          <div className="mt-10 flex flex-col gap-6">
            {POINTS.map(({ icon: Icon, title, body }) => (
              <div key={title} className="flex gap-3.5">
                <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-sm bg-on-invert-panel/[0.08]">
                  <Icon size={15} />
                </span>
                <div>
                  <div className="text-body font-semibold">{title}</div>
                  <p className="mt-0.5 text-subhead leading-relaxed text-on-invert-panel/60">{body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <p className="relative text-caption text-on-invert-panel/40">
          Runs on free-tier infrastructure. Your data stays in your own database.
        </p>
      </section>

      {/* Right: the form. */}
      <section className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-[380px]">
          <div className="mb-7 lg:hidden">
            <span className="grid h-8 w-8 place-items-center rounded-sm bg-accent text-callout font-bold text-on-accent">P</span>
          </div>

          <h2 className="text-heading">{mode === 'login' ? 'Welcome back' : 'Create your workspace'}</h2>
          <p className="mt-1.5 text-body text-ink-2">
            {mode === 'login' ? 'Sign in to pick up where you left off.' : 'Two minutes to your first answer.'}
          </p>

          <form onSubmit={handleSubmit} className="mt-7 space-y-4">
            {mode === 'signup' && (
              <label className="block">
                <span className="mb-1.5 block text-subhead font-medium text-ink-2">Name</span>
                <input value={name} onChange={(e) => setName(e.target.value)} className={field} />
              </label>
            )}
            <label className="block">
              <span className="mb-1.5 block text-subhead font-medium text-ink-2">Email</span>
              <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className={field} />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-subhead font-medium text-ink-2">Password</span>
              <input
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={field}
              />
              {mode === 'signup' && <span className="mt-1.5 block text-caption text-ink-3">At least 8 characters</span>}
            </label>

            {error && <InlineAlert>{error}</InlineAlert>}

            <Button type="submit" variant="primary" size="md" loading={loading} className="w-full">
              {mode === 'login' ? 'Sign in' : 'Create account'}
            </Button>
          </form>

          <button
            onClick={() => {
              setMode(mode === 'login' ? 'signup' : 'login');
              setError(null);
            }}
            className="mt-6 text-subhead text-ink-2 transition-colors hover:text-accent"
          >
            {mode === 'login' ? 'Need an account? Sign up' : 'Already have an account? Sign in'}
          </button>
        </div>
      </section>
    </main>
  );
}

// useSearchParams needs a Suspense boundary during prerender, or the build
// fails on this route.
export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
