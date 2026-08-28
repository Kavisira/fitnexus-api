import { Screen, UserRole } from '@prisma/client';

// Every screen the permission matrix currently covers — Attendance and
// Members are placeholders on the frontend today, but their rows exist
// now so nothing needs to change when those modules ship (same pattern
// as the notification config screen).
// DASHBOARD is deliberately excluded — it's always-on for every role
// (see RolesService.can/getForRole) and has no write action, so there's
// nothing for the matrix to configure.
export const ALL_SCREENS: Screen[] = [
  Screen.EMPLOYEES,
  Screen.ATTENDANCE,
  Screen.LEADS,
  Screen.NOTIFICATIONS,
  Screen.BRANCHES,
  Screen.MEMBERS,
  Screen.PLANS,
  Screen.EXPENSES,
];

// Roles whose access is governed by the RolePermission matrix. OWNER is
// deliberately excluded — the owner always has full access and never
// gets matrix rows of its own. STAFF/MEMBER aren't part of this pass
// (no login flow wires them up yet) but are harmless to seed too.
export const STAFF_ROLES: UserRole[] = [UserRole.BRANCH_MANAGER, UserRole.TRAINER, UserRole.FRONT_DESK];
