import { ExecutionContext, createParamDecorator } from '@nestjs/common';
import { UserRole } from '@prisma/client';

export interface AuthenticatedUser {
  userId: string;
  email: string;
  organizationId: string;
  role: UserRole;
  // Non-null only for staff (Trainer/Manager/Front Desk) logins — null
  // for the owner, who sees chain-wide data.
  branchId: string | null;
  // The Employee record this login was created from — non-null only
  // for staff logins, same as branchId. Used to scope "my leads" to
  // both leads this user created AND leads assigned to them.
  employeeId: string | null;
}

/** Use inside a route guarded by JwtAuthGuard: `@CurrentUser() user: AuthenticatedUser`. */
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
  const request = ctx.switchToHttp().getRequest();
  return request.user;
});
