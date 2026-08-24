import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesService } from '../../roles/roles.service';
import { PERMISSION_KEY, RequiredPermission } from '../decorators/require-permission.decorator';

/** Runs after JwtAuthGuard (so `request.user` is already populated).
 * Checks the route's @RequirePermission() metadata, if any, against the
 * caller's role via RolesService.can() — the owner role always passes
 * (see RolesService.can). A route with no @RequirePermission decorator
 * is left alone, so this is safe to add globally without auditing every
 * existing route first. */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private rolesService: RolesService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.get<RequiredPermission | undefined>(PERMISSION_KEY, context.getHandler());
    if (!required) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;
    if (!user) {
      return false;
    }

    const allowed = await this.rolesService.can(user.organizationId, user.role, required.screen, required.action);
    if (!allowed) {
      throw new ForbiddenException(`You don't have ${required.action} access to this screen.`);
    }
    return true;
  }
}
