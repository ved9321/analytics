'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import { api } from './apiClient';

// Reattaching to an answer that is still being written.
//
// The backend already ran the generation to completion regardless of
// whether the browser stayed connected — it persists the message either
// way. What was missing was any way back to it: returning to the chat page
// started a fresh conversation, so a finished answer sat in the database
// unread, and an in-flight one looked like nothing had happened.
//
// Two pieces fix that:
//   1. The active conversation id is remembered, so returning reopens it.
//   2. If the server says that conversation is still generating, poll until
//      the assistant message lands, then render it.

const ACTIVE_KEY = 'prism_active_conversation';
const POLL_INTERVAL_MS = 1500;
// Generous: a slow free model with several tool calls can genuinely take a
// while. The server-side staleness check is the real backstop.
const POLL_TIMEOUT_MS = 4 * 60_000;

export function rememberConversation(id: string | undefined) {
  if (typeof window === 'undefined') return;
  if (id) localStorage.setItem(ACTIVE_KEY, id);
  else localStorage.removeItem(ACTIVE_KEY);
}

export function recallConversation(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(ACTIVE_KEY);
}

export interface ResumeState {
  /** True while waiting for a server-side generation to finish. */
  resuming: boolean;
  /** The question being answered, shown so the wait has context. */
  pendingPrompt: string | null;
}

export function useChatResume(params: {
  workspaceId: string | undefined;
  /** Called once the in-flight answer has landed. */
  onResolved: (conversationId: string) => void;
}) {
  const [state, setState] = useState<ResumeState>({ resuming: false, pendingPrompt: null });
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelled = useRef(false);

  const stop = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    setState({ resuming: false, pendingPrompt: null });
  }, []);

  /** Polls a conversation until its generation completes. */
  const watch = useCallback(
    (conversationId: string, prompt: string | null) => {
      if (!params.workspaceId) return;
      setState({ resuming: true, pendingPrompt: prompt });
      const startedAt = Date.now();

      const tick = async () => {
        if (cancelled.current || !params.workspaceId) return;
        try {
          const conversation = await api.getConversation(params.workspaceId, conversationId);
          if (!conversation.generating) {
            stop();
            params.onResolved(conversationId);
            return;
          }
        } catch {
          // A transient failure shouldn't abandon the wait; the timeout
          // below is what eventually gives up.
        }

        if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
          stop();
          params.onResolved(conversationId);
          return;
        }
        timerRef.current = setTimeout(tick, POLL_INTERVAL_MS);
      };

      timerRef.current = setTimeout(tick, POLL_INTERVAL_MS);
    },
    [params, stop]
  );

  // On mount, reopen whatever was last active and reattach if it's still
  // running.
  useEffect(() => {
    cancelled.current = false;
    if (!params.workspaceId) return;

    const remembered = recallConversation();
    if (!remembered) return;

    api
      .listConversations(params.workspaceId)
      .then((conversations) => {
        const active = conversations.find((c) => c.id === remembered);
        if (!active) {
          // It was deleted elsewhere; don't keep pointing at it.
          rememberConversation(undefined);
          return;
        }
        if (active.generating) watch(active.id, active.pendingPrompt ?? null);
        else params.onResolved(active.id);
      })
      .catch(() => undefined);

    return () => {
      cancelled.current = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // Runs once per workspace; watch/onResolved are stable enough in practice
    // and re-running on every render would restart the poll continuously.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.workspaceId]);

  return { ...state, watch, stop };
}
