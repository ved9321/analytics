'use client';
import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from 'react';

// Theme, persisted, with a system option.
//
// The theme is applied to <html> as a data attribute rather than a class on a
// wrapper, so it is in scope for portals, the scrollbar and the page
// background — all of which sit outside any React root.

export type ThemeChoice = 'light' | 'dark' | 'system';
type Resolved = 'light' | 'dark';

const STORAGE_KEY = 'prism_theme';

interface ThemeContextValue {
  choice: ThemeChoice;
  resolved: Resolved;
  setChoice: (choice: ThemeChoice) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  choice: 'system',
  resolved: 'light',
  setChoice: () => {},
});

export function useTheme() {
  return useContext(ThemeContext);
}

function systemPrefers(): Resolved {
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [choice, setChoiceState] = useState<ThemeChoice>('system');
  const [resolved, setResolved] = useState<Resolved>('light');

  const apply = useCallback((next: ThemeChoice) => {
    const effective = next === 'system' ? systemPrefers() : next;
    document.documentElement.dataset.theme = effective;
    setResolved(effective);
  }, []);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY) as ThemeChoice | null;
    const initial = stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system';
    setChoiceState(initial);
    apply(initial);

    // The transition class is added only after the first paint, so the
    // initial theme doesn't animate in from the wrong colour on load.
    requestAnimationFrame(() => document.documentElement.classList.add('theme-ready'));

    // Following the system is only meaningful if it keeps following.
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      if ((localStorage.getItem(STORAGE_KEY) ?? 'system') === 'system') apply('system');
    };
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [apply]);

  const setChoice = useCallback(
    (next: ThemeChoice) => {
      setChoiceState(next);
      localStorage.setItem(STORAGE_KEY, next);
      apply(next);
    },
    [apply]
  );

  return <ThemeContext.Provider value={{ choice, resolved, setChoice }}>{children}</ThemeContext.Provider>;
}
