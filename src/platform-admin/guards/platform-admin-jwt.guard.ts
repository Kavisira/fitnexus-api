import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/** Drop `@UseGuards(PlatformAdminJwtGuard)` on any /platform-admin
 * route that requires the single platform-operator login — delegates
 * to PlatformAdminJwtStrategy ('platform-admin-jwt'), never to the
 * tenant-facing 'jwt' strategy every other guard in the app uses. */
@Injectable()
export class PlatformAdminJwtGuard extends AuthGuard('platform-admin-jwt') {}
