'use client';
import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { api, WorkspaceSummary } from './apiClient';

interface WorkspaceContextValue {
  workspace: WorkspaceSummary | null;
  workspaces: WorkspaceSummary[];
  loading: boolean;
  switchWorkspace: (id: string) => void;
  createWorkspace: (name: string) => Promise<void>;
  refresh: () => Promise<void>;
}

const WorkspaceContext = createContext<WorkspaceContextValue>({
  workspace: null,
  workspaces: [],
  loading: true,
  switchWorkspace: () => {},
  createWorkspace: async () => {},
  refresh: async () => {},
});

export function useWorkspace() {
  return useContext(WorkspaceContext);
}

const ACTIVE_WORKSPACE_KEY = 'prism_active_workspace';

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    let list = await api.listWorkspaces();
    if (list.length === 0) {
      const created = await api.createWorkspace('My Workspace');
      list = [{ id: created.id, name: created.name, role: 'ADMIN' }];
    }
    setWorkspaces(list);

    const saved = typeof window !== 'undefined' ? localStorage.getItem(ACTIVE_WORKSPACE_KEY) : null;
    const stillValid = saved && list.some((w) => w.id === saved);
    setActiveId(stillValid ? saved : list[0].id);
    setLoading(false);
  }, []);

  useEffect(() => {
    load().catch(() => router.replace('/login'));
  }, [load, router]);

  function switchWorkspace(id: string) {
    setActiveId(id);
    localStorage.setItem(ACTIVE_WORKSPACE_KEY, id);
  }

  async function createWorkspace(name: string) {
    const created = await api.createWorkspace(name);
    await load();
    switchWorkspace(created.id);
  }

  const workspace = workspaces.find((w) => w.id === activeId) ?? workspaces[0] ?? null;

  return (
    <WorkspaceContext.Provider value={{ workspace, workspaces, loading, switchWorkspace, createWorkspace, refresh: load }}>
      {children}
    </WorkspaceContext.Provider>
  );
}
