import { SetMetadata } from '@nestjs/common';
import { Screen } from '@prisma/client';

export const PERMISSION_KEY = 'requiredPermission';

export interface RequiredPermission {
  screen: Screen;
  action: 'read' | 'write';
}

/** Drop on a route alongside JwtAuthGuard + PermissionGuard, e.g.
 * `@RequirePermission(Screen.EMPLOYEES, 'write')`. A route with no
 * decorator is allowed through PermissionGuard unchecked — this is
 * opt-in per-route, not a blanket lockdown. */
export const RequirePermission = (screen: Screen, action: 'read' | 'write') =>
  SetMetadata(PERMISSION_KEY, { screen, action } as RequiredPermission);
