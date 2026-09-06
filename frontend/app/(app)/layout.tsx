'use client';
import { useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  LayoutGrid, MessageSquare, Database, Plug, Calculator, FileText, Ruler,
  Activity, Users, CreditCard, ChevronDown, LogOut, Plus, Search, Bell,
} from 'lucide-react';
import { WorkspaceProvider, useWorkspace } from '../../lib/workspaceContext';
import { DateRangeProvider } from '../../lib/dateRangeContext';
import { clearToken } from '../../lib/apiClient';
import { IconButton } from '../../components/ui';
import ThemeToggle from '../../components/ThemeToggle';
import { ThemeProvider } from '../../lib/themeContext';

// Top pill navigation rather than a sidebar.
//
// An analytics product is horizontal — wide tables, wide charts — and a
// 224px sidebar spent that width on eight links that never change. Moving
// navigation into a single pill row returns the full width to the data and
// puts the workspace switcher, search and account where people expect them.

const NAV = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutGrid },
  { href: '/chat', label: 'Chat', icon: MessageSquare },
  { href: '/data', label: 'Data', icon: Database },
  { href: '/connectors', label: 'Connectors', icon: Plug },
  { href: '/fields', label: 'Fields', icon: Ruler },
  { href: '/metrics', label: 'Metrics', icon: Calculator },
  { href: '/reports', label: 'Reports', icon: FileText },
  { href: '/health', label: 'Health', icon: Activity, roles: ['ADMIN', 'MANAGER'] },
  { href: '/admin', label: 'Admin', icon: Users, roles: ['ADMIN', 'MANAGER'] },
  { href: '/billing', label: 'Billing', icon: CreditCard, roles: ['ADMIN'] },
];

function WorkspaceMenu() {
  const { workspace, workspaces, switchWorkspace, createWorkspace } = useWorkspace();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex h-9 items-center gap-2 rounded-pill bg-card px-3 text-body font-medium shadow-control transition-colors hover:text-accent"
      >
        <span className="max-w-[140px] truncate">{workspace?.name ?? 'Workspace'}</span>
        <ChevronDown size={13} className={`text-ink-3 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <>
          {/* Click-away target: a menu you can only close by hitting the
              trigger again is a trap. */}
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-30 mt-2 w-60 overflow-hidden rounded-md border border-line-soft bg-card py-1.5 shadow-pop">
            <div className="px-3 pb-1.5 pt-1 text-micro uppercase text-ink-3">Workspaces</div>
            {workspaces.map((w) => (
              <button
                key={w.id}
                onClick={() => {
                  switchWorkspace(w.id);
                  setOpen(false);
                }}
                className={`flex w-full items-center justify-between px-3 py-2 text-left text-body hover:bg-sunken ${
                  w.id === workspace?.id ? 'font-medium text-ink' : 'text-ink-2'
                }`}
              >
                <span className="truncate">{w.name}</span>
                <span className="text-caption text-ink-3">{w.role.toLowerCase()}</span>
              </button>
            ))}
            <div className="mt-1 border-t border-line-soft p-2">
              {creating ? (
                <form
                  onSubmit={async (event) => {
                    event.preventDefault();
                    if (!name.trim()) return;
                    await createWorkspace(name.trim());
                    setName('');
                    setCreating(false);
                    setOpen(false);
                  }}
                >
                  <input
                    autoFocus
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="Workspace name"
                    className="w-full rounded-sm border border-line bg-sunken px-2.5 py-1.5 text-body outline-none focus:border-accent"
                  />
                </form>
              ) : (
                <button
                  onClick={() => setCreating(true)}
                  className="flex w-full items-center gap-2 rounded-sm px-1 py-1 text-body text-ink-2 hover:text-ink"
                >
                  <Plus size={13} /> New workspace
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { workspace } = useWorkspace();

  const items = NAV.filter((item) => !item.roles || (workspace && item.roles.includes(workspace.role)));

  return (
    <div className="min-h-screen bg-field">
      {/* Sticky translucent chrome, with content scrolling underneath rather
          than an opaque bar consuming a fixed strip. */}
      <header className="sticky top-0 z-30 bg-field/80 px-6 py-3.5 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1680px] items-center justify-between gap-4">
          <Link href="/dashboard" className="flex shrink-0 items-center gap-2.5">
            <span className="grid h-7 w-7 place-items-center rounded-sm bg-accent text-body font-bold text-on-accent">
              P
            </span>
            <span className="text-callout font-semibold tracking-tight">Prism</span>
          </Link>

          <nav className="flex items-center gap-0.5 overflow-x-auto rounded-pill border border-line-soft bg-card p-1 shadow-card">
            {items.map((item) => {
              const Icon = item.icon;
              const active = pathname?.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex shrink-0 items-center gap-1.5 rounded-pill px-3.5 py-2 text-body font-medium transition-colors duration-150 ease-apple ${
                    active ? 'bg-contrast text-on-contrast' : 'text-ink-2 hover:bg-sunken hover:text-ink'
                  }`}
                >
                  <Icon size={14} strokeWidth={2} />
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className="flex shrink-0 items-center gap-2">
            <ThemeToggle />
            <WorkspaceMenu />
            <IconButton aria-label="Search"><Search size={15} /></IconButton>
            <IconButton aria-label="Notifications"><Bell size={15} /></IconButton>
            <IconButton
              aria-label="Log out"
              onClick={() => {
                clearToken();
                router.replace('/login');
              }}
            >
              <LogOut size={15} />
            </IconButton>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1680px] px-6 pb-14">{children}</main>
    </div>
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <WorkspaceProvider>
        <DateRangeProvider>
          <Shell>{children}</Shell>
        </DateRangeProvider>
      </WorkspaceProvider>
    </ThemeProvider>
  );
}
