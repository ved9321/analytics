'use client';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { api } from '../../../lib/apiClient';
import { Button, InlineAlert, Skeleton } from '../../../components/ui';

export default function InvitePage() {
  const params = useParams<{ token: string }>();
  const router = useRouter();
  const token = params.token;

  const [invite, setInvite] = useState<{ email: string; role: string; workspaceName: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(false);
  const [loggedIn, setLoggedIn] = useState(false);

  useEffect(() => {
    setLoggedIn(Boolean(localStorage.getItem('prism_token')));
    api
      .getInvite(token)
      .then(setInvite)
      .catch((err) => setError(err instanceof Error ? err.message : 'This invite could not be found'))
      .finally(() => setLoading(false));
  }, [token]);

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-2">
          <div className="grid h-7 w-7 place-items-center rounded-sm bg-accent text-body font-bold text-white">
            P
          </div>
          <span className="text-callout font-semibold tracking-tight">Prism</span>
        </div>

        {loading && <Skeleton className="h-24" />}

        {error && <InlineAlert>{error}</InlineAlert>}

        {invite && (
          <div className="rounded-xl bg-card p-7 shadow-card">
            <p className="text-body leading-relaxed text-ink">
              You&apos;ve been invited to join <span className="text-signal">{invite.workspaceName}</span> as{' '}
              {invite.role.toLowerCase()}.
            </p>
            <p className="mt-1 text-subhead text-ink-2">Invitation sent to {invite.email}</p>

            <div className="mt-4">
              {loggedIn ? (
                <Button
                  variant="primary"
                  disabled={accepting}
                  onClick={async () => {
                    setAccepting(true);
                    setError(null);
                    try {
                      await api.acceptInvite(token);
                      router.push('/dashboard');
                    } catch (err) {
                      setError(err instanceof Error ? err.message : 'Could not accept this invite');
                      setAccepting(false);
                    }
                  }}
                >
                  {accepting ? 'Joining...' : 'Accept invitation'}
                </Button>
              ) : (
                <>
                  <Button variant="primary" onClick={() => router.push(`/login?next=/invite/${token}`)}>
                    Log in to accept
                  </Button>
                  <p className="mt-2 text-caption leading-relaxed text-ink-3">
                    Sign up or log in with {invite.email}, and you&apos;ll come straight back here.
                  </p>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
