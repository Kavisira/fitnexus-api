import { Injectable } from '@nestjs/common';
import { Screen, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ALL_SCREENS, STAFF_ROLES } from './roles.constants';

@Injectable()
export class RolesService {
  constructor(private prisma: PrismaService) {}

  /** Every (role, screen) row this org should have, seeded true/true —
   * called lazily (not just at org creation) so an org created before
   * this feature shipped still gets a full matrix the first time it's
   * read or a staff login is created. Existing rows are left untouched. */
  async ensureSeeded(organizationId: string): Promise<void> {
    const existing = await this.prisma.rolePermission.findMany({
      where: { organizationId },
      select: { role: true, screen: true },
    });
    const existingKeys = new Set(existing.map((r) => `${r.role}:${r.screen}`));

    const missing: { organizationId: string; role: UserRole; screen: Screen }[] = [];
    for (const role of STAFF_ROLES) {
      for (const screen of ALL_SCREENS) {
        if (!existingKeys.has(`${role}:${screen}`)) {
          missing.push({ organizationId, role, screen });
        }
      }
    }

    if (missing.length) {
      await this.prisma.rolePermission.createMany({ data: missing, skipDuplicates: true });
    }
  }

  async list(organizationId: string) {
    await this.ensureSeeded(organizationId);
    return this.prisma.rolePermission.findMany({
      where: { organizationId },
      orderBy: [{ role: 'asc' }, { screen: 'asc' }],
    });
  }

  /** The current user's own permission row for every screen, resolved
   * from their JWT role claim — this is what the frontend loads once
   * per session (see PermissionsService) to drive sidenav visibility,
   * route guards, and per-action (add/edit) gating everywhere. OWNER
   * gets every screen true/true without a DB lookup, matching `can()`. */
  async getForRole(organizationId: string, role: UserRole): Promise<Record<Screen, { canRead: boolean; canWrite: boolean }>> {
    const result = {} as Record<Screen, { canRead: boolean; canWrite: boolean }>;

    if (role === UserRole.OWNER) {
      for (const screen of ALL_SCREENS) {
        result[screen] = { canRead: true, canWrite: true };
      }
      return result;
    }

    await this.ensureSeeded(organizationId);
    const rows = await this.prisma.rolePermission.findMany({ where: { organizationId, role } });
    const byScreen = new Map(rows.map((r) => [r.screen, r]));
    for (const screen of ALL_SCREENS) {
      const row = byScreen.get(screen);
      result[screen] = { canRead: row?.canRead ?? false, canWrite: row?.canWrite ?? false };
    }
    return result;
  }

  async updateCell(organizationId: string, role: UserRole, screen: Screen, canRead: boolean, canWrite: boolean) {
    await this.ensureSeeded(organizationId);
    // Writing implies reading — a role can't be given write without read,
    // enforced here rather than trusting the frontend checkboxes alone.
    const effectiveRead = canRead || canWrite;
    return this.prisma.rolePermission.upsert({
      where: { organizationId_role_screen: { organizationId, role, screen } },
      create: { organizationId, role, screen, canRead: effectiveRead, canWrite },
      update: { canRead: effectiveRead, canWrite },
    });
  }

  /** Core permission check used by PermissionGuard. Owner always passes
   * without a DB lookup — everyone else is checked against their org's
   * matrix row for this (role, screen). No row found = no access,
   * fail-closed rather than fail-open. */
  async can(organizationId: string, role: UserRole, screen: Screen, action: 'read' | 'write'): Promise<boolean> {
    if (role === UserRole.OWNER) {
      return true;
    }
    const row = await this.prisma.rolePermission.findUnique({
      where: { organizationId_role_screen: { organizationId, role, screen } },
    });
    if (!row) {
      return false;
    }
    return action === 'write' ? row.canWrite : row.canRead;
  }
}
