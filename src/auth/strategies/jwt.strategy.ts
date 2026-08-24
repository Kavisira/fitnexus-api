import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { UserRole } from '@prisma/client';

interface JwtPayload {
  sub: string;
  email: string;
  organizationId?: string;
  role?: UserRole;
  branchId?: string | null;
  employeeId?: string | null;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('JWT_SECRET') ?? 'change-me-in-production',
    });
  }

  validate(payload: JwtPayload) {
    // Reject tokens minted before organizationId was added to the JWT
    // payload (or any otherwise malformed token) instead of letting
    // `request.user.organizationId` silently come back undefined —
    // that used to reach Prisma as `organizationId: undefined` and blow
    // up with a confusing "Argument `organization` is missing" error.
    // Throwing 401 here makes the frontend's existing interceptor clear
    // the stale token and redirect to /login with a normal "session
    // expired" toast instead.
    if (!payload.organizationId) {
      throw new UnauthorizedException('Session is invalid — please log in again.');
    }

    // Whatever this returns becomes `request.user` in guarded routes —
    // organizationId lets every feature module scope its queries to the
    // caller's tenant without a DB round-trip on every request. role,
    // branchId, and employeeId ride along the same way, for
    // PermissionGuard, branch-scoped queries, and "assigned to me"
    // lead scoping — tokens minted before these existed just come back
    // as role: OWNER / branchId: null / employeeId: null (see the
    // fallbacks below), which matches the only accounts that existed
    // before these features shipped.
    return {
      userId: payload.sub,
      email: payload.email,
      organizationId: payload.organizationId,
      role: payload.role ?? UserRole.OWNER,
      branchId: payload.branchId ?? null,
      employeeId: payload.employeeId ?? null,
    };
  }
}
