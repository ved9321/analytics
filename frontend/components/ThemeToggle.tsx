'use client';
import { Sun, Moon, Monitor } from 'lucide-react';
import { useTheme, ThemeChoice } from '../lib/themeContext';

const OPTIONS: { value: ThemeChoice; icon: typeof Sun; label: string }[] = [
  { value: 'light', icon: Sun, label: 'Light' },
  { value: 'dark', icon: Moon, label: 'Dark' },
  { value: 'system', icon: Monitor, label: 'System' },
];

/** Three-state control rather than a toggle, so "follow my system" is a real
 *  choice instead of something the app decides silently. */
export default function ThemeToggle() {
  const { choice, setChoice } = useTheme();

  return (
    <div role="radiogroup" aria-label="Theme" className="inline-flex items-center rounded-pill bg-card p-[3px] shadow-control">
      {OPTIONS.map(({ value, icon: Icon, label }) => (
        <button
          key={value}
          role="radio"
          aria-checked={choice === value}
          aria-label={label}
          title={label}
          onClick={() => setChoice(value)}
          className={`grid h-[26px] w-[26px] place-items-center rounded-pill transition-colors duration-150 ${
            choice === value ? 'bg-contrast text-on-contrast' : 'text-ink-3 hover:text-ink'
          }`}
        >
          <Icon size={13} strokeWidth={2} />
        </button>
      ))}
    </div>
  );
}
