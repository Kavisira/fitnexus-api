import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

interface JwtPayload {
  sub: string;
  email: string;
  organizationId?: string;
  role?: UserRole;
  branchId?: string | null;
  employeeId?: string | null;
  // The session id this token was issued with (see
  // AuthService.issueToken) — absent on any token minted before this
  // field existed, which validate() treats as a mismatch (see below).
  sid?: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('JWT_SECRET') ?? 'change-me-in-production',
    });
  }

  async validate(payload: JwtPayload) {
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

    // One device per login at a time: every successful login mints a
    // fresh session id and saves it as the user's currentSessionId
    // (see AuthService.issueToken). If this token's own `sid` doesn't
    // match what's on the user's row right now, a newer login has
    // happened elsewhere since this token was issued — reject it with
    // a distinguishable code so the frontend can show "logged in
    // elsewhere" instead of a generic "session expired" message (see
    // auth.interceptor.ts). A token with no `sid` at all (minted
    // before this feature shipped) is always treated as a mismatch —
    // those get rejected the same way, a one-time re-login is expected
    // right after this ships.
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { currentSessionId: true },
    });
    if (!user || !payload.sid || user.currentSessionId !== payload.sid) {
      throw new UnauthorizedException({
        message: 'This account was signed in on another device.',
        code: 'SESSION_REPLACED',
      });
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
