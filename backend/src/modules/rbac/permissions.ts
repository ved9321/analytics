// Pure permission logic — deliberately free of any database or config
// import so it can be unit-tested (and reasoned about) in isolation. The
// middleware that needs Prisma lives in ./rbac.ts.

export type Role = 'ADMIN' | 'MANAGER' | 'ANALYST' | 'VIEWER';

export type Permission =
  | 'billing.manage'
  | 'users.invite'
  | 'connectors.manage'
  | 'apiKeys.manage'
  | 'chat.ask'
  | 'chat.askScoped'
  | 'dashboards.view'
  | 'reports.create'
  | 'metrics.customize'
  | 'data.export'
  | 'audit.view'
  | 'alerts.configure';

// Mirrors the permission matrix in the platform spec, §4.5. Keep this in
// sync with that table if the roadmap adds a role or capability.
const MATRIX: Record<Role, Permission[]> = {
  ADMIN: [
    'billing.manage', 'users.invite', 'connectors.manage', 'apiKeys.manage',
    'chat.ask', 'dashboards.view', 'reports.create', 'metrics.customize',
    'data.export', 'audit.view', 'alerts.configure',
  ],
  MANAGER: [
    'users.invite', 'connectors.manage', 'apiKeys.manage',
    'chat.ask', 'dashboards.view', 'reports.create', 'metrics.customize',
    'data.export', 'audit.view', 'alerts.configure',
  ],
  ANALYST: [
    'chat.ask', 'dashboards.view', 'reports.create', 'metrics.customize',
    'data.export', 'alerts.configure',
  ],
  VIEWER: ['chat.askScoped', 'dashboards.view'],
};

export function can(role: Role, permission: Permission): boolean {
  return MATRIX[role]?.includes(permission) ?? false;
}
