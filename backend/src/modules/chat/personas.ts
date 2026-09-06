// Personas.
//
// The same figures mean different things to different readers. A growth lead
// asked "how did we do" wants the decision — where the money should move. An
// analyst wants the caveat and the method. An executive wants one sentence
// and the direction of travel.
//
// Previously every answer was written for a generic reader, which meant it
// was slightly wrong for everyone. The persona is chosen once at signup and
// changes the instructions the model receives, not the data it is given —
// the numbers are identical, only the framing moves.

export type PersonaId = 'growth' | 'analyst' | 'executive' | 'founder';

export interface Persona {
  id: PersonaId;
  label: string;
  blurb: string;
  /** Metrics surfaced first on the dashboard and in findings. */
  defaultMetrics: string[];
  /** Appended to the answer instructions. */
  guidance: string;
}

export const PERSONAS: Persona[] = [
  {
    id: 'growth',
    label: 'Growth / performance marketing',
    blurb: 'You buy media and care where the next pound goes.',
    defaultMetrics: ['cost', 'conversions', 'conversion_value', 'clicks'],
    guidance: `This reader buys media daily. Lead with the decision, not the description:
which campaign or channel should get more budget and which should get less, and
why. Always frame cost against return — a spend figure alone is not an answer.
Name the specific campaign. If the data supports an action, say what it is.`,
  },
  {
    id: 'analyst',
    label: 'Data / analytics',
    blurb: 'You need the method and the caveats, not just the number.',
    defaultMetrics: ['sessions', 'conversions', 'cost', 'revenue'],
    guidance: `This reader will check your working. State the period and grouping
explicitly, flag anything that limits confidence — sampling, an "(other)"
bucket, a partial window, a metric that means different things across
platforms — and prefer precision over reassurance. Do not round away detail
that changes the interpretation.`,
  },
  {
    id: 'executive',
    label: 'Executive / leadership',
    blurb: 'You want the headline and the direction of travel.',
    defaultMetrics: ['revenue', 'cost', 'conversions'],
    guidance: `This reader has thirty seconds. One sentence on what happened, one on
whether that is good, one on what it depends on. No campaign names unless one
genuinely explains the whole movement. Absolute figures with a percentage
change — never a percentage alone, which hides the scale.`,
  },
  {
    id: 'founder',
    label: 'Founder / generalist',
    blurb: 'You want it in plain terms, without the jargon.',
    defaultMetrics: ['revenue', 'cost', 'sessions', 'conversions'],
    guidance: `Write for someone fluent in the business but not in analytics jargon.
Expand an acronym the first time it appears. Explain why a number matters, not
just what it is. Avoid platform-specific terminology where a plain word works.`,
  },
];

export function findPersona(id: string | null | undefined): Persona | undefined {
  return PERSONAS.find((persona) => persona.id === id);
}

/** The block appended to the system prompt. Empty when no persona is set. */
export function personaGuidance(id: string | null | undefined, focusMetrics: string[] = []): string {
  const persona = findPersona(id);
  if (!persona) return '';

  const focus = focusMetrics.length ? focusMetrics : persona.defaultMetrics;
  return [
    '',
    `[READER — ${persona.label}]`,
    persona.guidance.trim(),
    focus.length ? `They have said they care most about: ${focus.join(', ')}. Prefer these when choosing what to lead with.` : '',
  ]
    .filter(Boolean)
    .join('\n');
}
