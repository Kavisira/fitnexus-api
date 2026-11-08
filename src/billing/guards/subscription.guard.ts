import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../prisma/prisma.service';
import { isOrgSubscriptionExpired } from '../billing.constants';

// Routes that must keep working for an org whose trial/paid period has
// run out — otherwise nobody could ever see the billing page or pay to
// fix it, and nobody could even log out. Matched against
// request.originalUrl, so these are substring checks, not exact routes
// (e.g. '/billing' also covers '/billing/status', '/billing/checkout',
// '/billing/webhook', etc).
const ALWAYS_ALLOWED_PATH_FRAGMENTS = [
  '/billing',
  '/auth/me',
  '/auth/logout',
  '/auth/login',
  '/version',
  // The screen×permission matrix is session-bootstrapping metadata,
  // not business data — every authenticated route's own guard
  // (authGuard on the frontend) fetches this before anything else can
  // even render, INCLUDING the trip to /billing itself. Without this
  // allowlisted, an expired org's Owner could never reach the one
  // page meant to still work for them — the fetch would 403, the
  // frontend guard's observable would error, and the navigation would
  // simply fail silently, stranding them wherever they started.
  '/roles/permissions',
];

/**
 * Global guard (registered as APP_GUARD in app.module.ts, so it runs on
 * every route in every controller without each one needing its own
 * @UseGuards entry) that blocks ALL requests — reads included, not
 * just writes — the instant an org's trial or paid subscription period
 * has run out, outside the small allowlist above. This is the backend
 * half of the hard-lockout policy: the frontend route guard blocks
 * navigation, but without this, anyone could still pull every member's
 * data and payment history straight from the API (devtools, a saved
 * request, a future mobile client) with zero UI access at all.
 *
 * IMPORTANT — this guard deliberately does NOT read request.user.
 * It used to (relying on JwtStrategy.validate() having already
 * attached `isSubscriptionExpired` to it), but request.user is only
 * ever populated by JwtAuthGuard, which is applied per-controller via
 * @UseGuards — and a globally-registered APP_GUARD like this one
 * ALWAYS runs before any controller-level guard. That meant
 * request.user was always undefined here, and this guard's write-block
 * never actually fired in production. Fixed by having this guard
 * verify the bearer token itself, independent of controller-level auth
 * guards and their ordering.
 *
 * A request with no valid/decodable token is left alone — this guard
 * only ever narrows access for an identifiable, expired org; it never
 * grants or denies access on its own authority. An expired-but-missing
 * token request still 401s normally, just from JwtAuthGuard/PermissionGuard
 * further down the chain, not from here.
 */
@Injectable()
export class SubscriptionGuard implements CanActivate {
  constructor(
    private jwtService: JwtService,
    private prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const url: string = request.originalUrl ?? request.url ?? '';

    if (ALWAYS_ALLOWED_PATH_FRAGMENTS.some((fragment) => url.includes(fragment))) {
      return true;
    }

    const organizationId = await this.resolveOrganizationId(request);
    if (!organizationId) {
      return true;
    }

    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { subscriptionStatus: true, currentPeriodEnd: true },
    });
    if (!org || !isOrgSubscriptionExpired(org)) {
      return true;
    }

    throw new ForbiddenException({
      message: 'Your subscription has expired. Please upgrade to continue.',
      code: 'SUBSCRIPTION_EXPIRED',
    });
  }

  /** Decodes + verifies the bearer token directly rather than trusting
   * request.user (see the class doc comment for why). Verifying the
   * signature (not just decoding the payload) means a tampered or
   * expired token can't be used to probe org status either. */
  private async resolveOrganizationId(request: { headers?: { authorization?: string } }): Promise<string | undefined> {
    const header = request.headers?.authorization;
    if (!header?.startsWith('Bearer ')) {
      return undefined;
    }
    const token = header.slice('Bearer '.length);
    try {
      const payload = await this.jwtService.verifyAsync(token);
      return typeof payload?.organizationId === 'string' ? payload.organizationId : undefined;
    } catch {
      return undefined;
    }
  }
}
