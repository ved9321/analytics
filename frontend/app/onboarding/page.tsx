'use client';
import { Suspense, useEffect, useState, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { TrendingUp, LineChart, Briefcase, Rocket, ArrowRight } from 'lucide-react';
import { api } from '../../lib/apiClient';
import { InlineAlert } from '../../components/ui';

// Onboarding is one decision.
//
// The previous version asked for a role and then a metric multi-select — two
// steps and eight checkboxes before anyone had seen the product. Every extra
// field here is paid for by someone who just wants to get in.
//
// So: pick a role, which auto-advances. Metrics are inferred from that choice
// and shown as a confirmation, not a question. Number keys work, skip is
// always visible, and the whole thing is one screen.

const ICONS: Record<string, typeof TrendingUp> = {
  growth: TrendingUp,
  analyst: LineChart,
  executive: Briefcase,
  founder: Rocket,
};

const METRIC_LABELS: Record<string, string> = {
  cost: 'Spend', revenue: 'Revenue', conversions: 'Conversions',
  conversion_value: 'Conversion value', sessions: 'Sessions',
  clicks: 'Clicks', impressions: 'Impressions', active_users: 'Active users',
};

interface PersonaOption {
  id: string;
  label: string;
  blurb: string;
  defaultMetrics: string[];
}

function Onboarding() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get('next') || '/dashboard';

  const [personas, setPersonas] = useState<PersonaOption[]>([]);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.listPersonas().then((result) => setPersonas(result.personas)).catch(() => setPersonas([]));
  }, []);

  // Choosing commits immediately. A separate confirm step buys nothing when
  // the choice is reversible and clearly labelled as such.
  const choose = useCallback(
    async (persona: PersonaOption) => {
      if (saving) return;
      setSaving(persona.id);
      setError(null);
      try {
        await api.setPersona(persona.id, persona.defaultMetrics);
        router.push(next);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not save that');
        setSaving(null);
      }
    },
    [saving, router, next]
  );

  // Number keys, because anyone who does this twice will want them.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const index = Number(event.key) - 1;
      if (Number.isInteger(index) && index >= 0 && index < personas.length) choose(personas[index]);
      if (event.key === 'Escape') router.push(next);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [personas, choose, router, next]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6 py-16">
      <div className="w-full max-w-2xl">
        <div className="mb-10 text-center">
          <span className="mx-auto grid h-9 w-9 place-items-center rounded-sm bg-accent text-callout font-bold text-on-accent">
            P
          </span>
          <h1 className="mt-7 text-display">What best describes your work?</h1>
          <p className="mx-auto mt-2.5 max-w-md text-callout leading-relaxed text-ink-2">
            Answers get written for you specifically. Same numbers either way — what gets led with changes.
          </p>
        </div>

        <div className="grid gap-2.5 sm:grid-cols-2">
          {personas.map((persona, index) => {
            const Icon = ICONS[persona.id] ?? TrendingUp;
            const busy = saving === persona.id;
            return (
              <button
                key={persona.id}
                onClick={() => choose(persona)}
                disabled={Boolean(saving)}
                className={`group relative flex flex-col rounded-lg border bg-card p-5 text-left shadow-control transition-all duration-200 ease-apple disabled:opacity-60 ${
                  busy ? 'border-accent ring-2 ring-accent/25' : 'border-line-soft hover:-translate-y-0.5 hover:border-accent hover:shadow-card'
                }`}
              >
                <div className="mb-3.5 flex items-center justify-between">
                  <span className="grid h-10 w-10 place-items-center rounded-md bg-accent-soft text-accent">
                    <Icon size={18} strokeWidth={2} />
                  </span>
                  <kbd className="rounded-sm bg-sunken px-2 py-1 text-caption font-medium text-ink-3">{index + 1}</kbd>
                </div>

                <span className="text-callout font-semibold">{persona.label}</span>
                <span className="mt-1 text-subhead leading-relaxed text-ink-2">{persona.blurb}</span>

                {/* Metrics are shown, not asked. Seeing what the choice
                    implies is reassurance; making it a second form is a tax. */}
                <span className="mt-3.5 flex flex-wrap gap-1.5">
                  {persona.defaultMetrics.slice(0, 3).map((metric) => (
                    <span key={metric} className="rounded-pill bg-sunken px-2 py-0.5 text-caption text-ink-3">
                      {METRIC_LABELS[metric] ?? metric}
                    </span>
                  ))}
                </span>

                <span
                  className={`mt-4 inline-flex items-center gap-1.5 text-subhead font-medium transition-colors ${
                    busy ? 'text-accent' : 'text-ink-3 group-hover:text-accent'
                  }`}
                >
                  {busy ? 'Setting up…' : 'Choose'}
                  <ArrowRight size={13} className="transition-transform group-hover:translate-x-0.5" />
                </span>
              </button>
            );
          })}
        </div>

        {error && <div className="mt-5"><InlineAlert>{error}</InlineAlert></div>}

        <div className="mt-8 flex items-center justify-center gap-4 text-subhead text-ink-3">
          <button onClick={() => router.push(next)} className="transition-colors hover:text-ink">
            Skip
          </button>
          <span aria-hidden>·</span>
          <span>Change it any time in settings</span>
        </div>
      </div>
    </main>
  );
}

export default function OnboardingPage() {
  return (
    <Suspense fallback={null}>
      <Onboarding />
    </Suspense>
  );
}
