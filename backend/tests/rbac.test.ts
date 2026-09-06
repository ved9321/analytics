import { describe, it, expect } from 'vitest';
import { can, Role, Permission } from '../src/modules/rbac/permissions';

// Asserts the permission matrix against spec §4.5's table directly. If
// someone widens a role by accident, this is what catches it.
describe('RBAC permission matrix', () => {
  it('gives billing management to Admin only', () => {
    expect(can('ADMIN', 'billing.manage')).toBe(true);
    for (const role of ['MANAGER', 'ANALYST', 'VIEWER'] as Role[]) {
      expect(can(role, 'billing.manage')).toBe(false);
    }
  });

  it('lets Admin and Manager invite users, but not Analyst or Viewer', () => {
    expect(can('ADMIN', 'users.invite')).toBe(true);
    expect(can('MANAGER', 'users.invite')).toBe(true);
    expect(can('ANALYST', 'users.invite')).toBe(false);
    expect(can('VIEWER', 'users.invite')).toBe(false);
  });

  it('restricts connector management to Admin and Manager', () => {
    expect(can('ADMIN', 'connectors.manage')).toBe(true);
    expect(can('MANAGER', 'connectors.manage')).toBe(true);
    expect(can('ANALYST', 'connectors.manage')).toBe(false);
    expect(can('VIEWER', 'connectors.manage')).toBe(false);
  });

  it('gives Viewer scoped chat but never open-ended chat', () => {
    expect(can('VIEWER', 'chat.askScoped')).toBe(true);
    expect(can('VIEWER', 'chat.ask')).toBe(false);
  });

  it('lets every role view dashboards', () => {
    for (const role of ['ADMIN', 'MANAGER', 'ANALYST', 'VIEWER'] as Role[]) {
      expect(can(role, 'dashboards.view')).toBe(true);
    }
  });

  it('blocks Viewer from creating reports, exporting, or defining metrics', () => {
    const denied: Permission[] = ['reports.create', 'data.export', 'metrics.customize', 'alerts.configure'];
    for (const permission of denied) {
      expect(can('VIEWER', permission)).toBe(false);
      expect(can('ANALYST', permission)).toBe(true);
    }
  });

  it('restricts audit log viewing to Admin and Manager', () => {
    expect(can('ADMIN', 'audit.view')).toBe(true);
    expect(can('MANAGER', 'audit.view')).toBe(true);
    expect(can('ANALYST', 'audit.view')).toBe(false);
  });

  it('denies unknown roles and permissions rather than defaulting open', () => {
    expect(can('NOT_A_ROLE' as Role, 'dashboards.view')).toBe(false);
    expect(can('ADMIN', 'not.a.permission' as Permission)).toBe(false);
  });
});
