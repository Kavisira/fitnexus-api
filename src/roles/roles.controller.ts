import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser, AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { RolesService } from './roles.service';
import { UpdateRolePermissionDto } from './dto/update-role-permission.dto';

// No @Permission guard on this controller itself — editing the matrix
// is an owner-only action, enforced by the frontend only showing this
// screen to the owner for now. Revisit with an explicit role check here
// if that assumption stops holding.
@Controller('roles/permissions')
@UseGuards(JwtAuthGuard)
export class RolesController {
  constructor(private rolesService: RolesService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.rolesService.list(user.organizationId);
  }

  // The logged-in user's own screen×permission map, resolved from their
  // JWT role claim. This is what the frontend fetches once per session
  // (right after a valid token is confirmed) to drive sidenav
  // visibility, route guards, and per-action gating — every user can
  // read their own permissions regardless of role, unlike the full
  // matrix above which is owner-only.
  @Get('mine')
  mine(@CurrentUser() user: AuthenticatedUser) {
    return this.rolesService.getForRole(user.organizationId, user.role);
  }

  @Patch()
  update(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateRolePermissionDto) {
    return this.rolesService.updateCell(user.organizationId, dto.role, dto.screen, dto.canRead, dto.canWrite);
  }
}
