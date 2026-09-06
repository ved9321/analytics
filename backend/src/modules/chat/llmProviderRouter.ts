import { env } from '../../env';
import { resolveChain, recordSuccess, recordFailure, Task } from './modelRegistry';

// Provider-agnostic chat completion.
//
// WHY THIS SHAPE. Free models vary enormously in whether they support
// native tool-calling, and those that claim to often emit malformed
// arguments. Depending on tool-calling would mean the product works on
// some models and silently degrades on others — the opposite of "similar
// responses no matter the model".
//
// So this layer offers exactly one primitive: send messages, get text
// back. All structure (which data to fetch, what chart to draw) is handled
// deterministically in queryPlanner.ts and chartBuilder.ts, where it can
// be validated and repaired. The model is used for two things it is
// reliably good at even at the free tier: choosing a query plan from a
// constrained menu, and writing prose about numbers it has been handed.
//
// Requesty and OpenRouter are OpenAI-compatible, so they share one request
// path. Anthropic is supported through its own endpoint.

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface CompletionOptions {
  messages: ChatMessage[];
  model?: string;
  maxTokens?: number;
  /** Set false to let a model reason in the content channel (planner only). */
  excludeReasoning?: boolean;
  /** Which job this call is for; drives model selection. */
  task?: Task;
  temperature?: number;
  /** Streams user-visible text as it arrives. */
  onToken?: (token: string) => void;
  /** Ask for JSON. Weak models need the nudge in the prompt too. */
  json?: boolean;
}

export interface CompletionResult {
  text: string;
  /** Provider's separate reasoning channel, when the model populated it. */
  reasoning?: string;
  /** True when the provider reported finish_reason 'length'. */
  truncated?: boolean;
  finishReason?: string | null;
  model: string;
  inputTokens: number;
  outputTokens: number;
  /** Models tried and rejected before the one that worked. */
  attempts: { model: string; error: string }[];
}

export class AllModelsFailedError extends Error {
  constructor(public attempts: { model: string; error: string }[]) {
    super(
      `Every configured model failed. Tried: ${attempts
        .map((a) => `${a.model} (${a.error})`)
        .join('; ')}. Check the active provider's health, keys, and rate limits, or select another configured model.`
    );
  }
}

const DEFAULT_MAX_TOKENS = 1600;

// --- OpenRouter (OpenAI-compatible) ------------------------------------

async function openAICompatibleCompletion(
  model: string,
  options: CompletionOptions,
  baseUrl: string,
  apiKey: string,
  extraHeaders: Record<string, string> = {},
): Promise<CompletionResult> {
  const streaming = Boolean(options.onToken);

  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...extraHeaders,
    },
    body: JSON.stringify({
      model,
      messages: options.messages,
      max_tokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
      temperature: options.temperature ?? 0.2,
      stream: streaming,
      // Ask reasoning models to keep their chain-of-thought out of the
      // content channel entirely. OpenRouter routes this to whichever
      // provider-specific flag applies; models that don't support it
      // ignore it, which is why answerExtractor still does structural
      // separation rather than trusting this.
      ...(options.excludeReasoning === false ? {} : { reasoning: { exclude: true } }),
      // Only a hint: many free models ignore it, which is why the JSON
      // parsing in queryPlanner is defensive rather than trusting.
      ...(options.json ? { response_format: { type: 'json_object' } } : {}),
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${response.status} ${body.slice(0, 300)}`);
  }

  if (!streaming) {
    const data = (await response.json()) as {
      choices?: {
        message?: { content?: string; reasoning?: string };
        finish_reason?: string;
        native_finish_reason?: string;
      }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
      error?: { message?: string };
    };
    if (data.error) throw new Error(data.error.message ?? 'provider error');

    const choice = data.choices?.[0];
    const finishReason = choice?.finish_reason ?? choice?.native_finish_reason ?? null;
    return {
      text: choice?.message?.content ?? '',
      // Kept separate so the orchestrator can tell "the model reasoned in
      // its own channel" from "the model reasoned into the answer".
      reasoning: choice?.message?.reasoning ?? undefined,
      model,
      inputTokens: data.usage?.prompt_tokens ?? 0,
      outputTokens: data.usage?.completion_tokens ?? 0,
      // 'length' means the model was cut off mid-generation.
      truncated: finishReason === 'length',
      finishReason,
      attempts: [],
    };
  }

  // --- SSE streaming ---
  if (!response.body) throw new Error('no response body to stream');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  let inputTokens = 0;
  let outputTokens = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;

      try {
        const chunk = JSON.parse(payload) as {
          choices?: { delta?: { content?: string } }[];
          usage?: { prompt_tokens?: number; completion_tokens?: number };
          error?: { message?: string };
        };
        if (chunk.error) throw new Error(chunk.error.message ?? 'provider error mid-stream');
        const delta = chunk.choices?.[0]?.delta?.content;
        if (delta) {
          text += delta;
          options.onToken?.(delta);
        }
        if (chunk.usage) {
          inputTokens = chunk.usage.prompt_tokens ?? inputTokens;
          outputTokens = chunk.usage.completion_tokens ?? outputTokens;
        }
      } catch (err) {
        // A single malformed SSE frame shouldn't abort a good stream, but
        // an error frame should propagate.
        if (err instanceof Error && err.message.includes('provider error')) throw err;
      }
    }
  }

  return { text, model, inputTokens, outputTokens, attempts: [] };
}

async function openRouterCompletion(model: string, options: CompletionOptions) {
  return openAICompatibleCompletion(
    model,
    options,
    'https://openrouter.ai/api/v1',
    env.OPENROUTER_API_KEY ?? '',
    { 'HTTP-Referer': env.APP_URL, 'X-Title': 'Prism Analytics' },
  );
}

async function requestyCompletion(model: string, options: CompletionOptions) {
  return openAICompatibleCompletion(
    model,
    options,
    env.REQUESTY_BASE_URL,
    env.REQUESTY_API_KEY ?? '',
    { 'HTTP-Referer': env.APP_URL, 'X-Title': 'Prism Analytics' },
  );
}

// --- Anthropic ---------------------------------------------------------

async function anthropicCompletion(model: string, options: CompletionOptions): Promise<CompletionResult> {
  const system = options.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
  const messages = options.messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': env.ANTHROPIC_API_KEY ?? '',
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
      temperature: options.temperature ?? 0.2,
      ...(system ? { system } : {}),
      messages,
    }),
  });

  if (!response.ok) throw new Error(`${response.status} ${(await response.text()).slice(0, 300)}`);

  const data = (await response.json()) as {
    content?: { type: string; text?: string }[];
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  const text = (data.content ?? []).filter((b) => b.type === 'text').map((b) => b.text ?? '').join('');

  // Emitted in one piece: this path exists for output quality, and the UI
  // handles a single large chunk the same as many small ones.
  if (text) options.onToken?.(text);

  return {
    text,
    model,
    inputTokens: data.usage?.input_tokens ?? 0,
    outputTokens: data.usage?.output_tokens ?? 0,
    attempts: [],
  };
}

/**
 * Tries each configured model in order. Free models hit daily rate limits,
 * so falling through to the next one is the normal case rather than an
 * exceptional one.
 *
 * Streaming callbacks only fire for the model that actually succeeds: a
 * failure is detected on the HTTP response before any token is emitted.
 */
export async function complete(options: CompletionOptions): Promise<CompletionResult> {
  const attempts: { model: string; error: string }[] = [];
  // Routed per task: the planner only needs parseable JSON, narration needs
  // fluency. Health-aware, so a model that just rate-limited is skipped
  // rather than retried on every request.
  const chain = resolveChain(options.task ?? 'narration', options.model);

  for (const model of chain) {
    const startedAt = Date.now();
    try {
      const result =
        env.AI_PROVIDER === 'anthropic'
          ? await anthropicCompletion(model, options)
          : await openRouterCompletion(model, options);

      // A model that returns nothing is a failure, not a valid empty
      // answer — some free models respond 200 with an empty choice when
      // overloaded.
      if (!result.text.trim()) throw new Error('empty response');

      recordSuccess(model, Date.now() - startedAt);
      return { ...result, attempts };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown error';
      recordFailure(model, message);
      attempts.push({ model, error: message });
    }
  }

  throw new AllModelsFailedError(attempts);
}

/** Convenience wrapper for one-shot prompts with no streaming. */
export async function ask(
  system: string,
  user: string,
  opts: { json?: boolean; maxTokens?: number; model?: string; task?: Task } = {},
) {
  return complete({
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    json: opts.json,
    model: opts.model,
    maxTokens: opts.maxTokens,
    task: opts.task,
    temperature: 0,
  });
}
