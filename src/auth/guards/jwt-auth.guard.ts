import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/** Drop `@UseGuards(JwtAuthGuard)` on any controller/route that requires
 * a logged-in user — it delegates to JwtStrategy, which verifies the
 * bearer token and attaches `{ userId, email, organizationId }` to
 * `request.user` (read it with `@CurrentUser()`). */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
