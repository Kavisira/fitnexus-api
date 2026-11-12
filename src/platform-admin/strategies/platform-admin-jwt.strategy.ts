import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../prisma/prisma.service';

interface PlatformAdminJwtPayload {
  sub: string;
  email: string;
  type: 'platform-admin';
}

/** A second, independent Passport strategy (registered name
 * 'platform-admin-jwt', NOT the default 'jwt' every tenant route uses)
 * so a platform-admin token and a tenant User token can never be used
 * interchangeably — this strategy rejects anything whose payload isn't
 * explicitly shaped like a platform-admin token (see `type` check
 * below), and the regular JwtStrategy never looks at PlatformAdmin
 * rows at all. Verifies against the same JWT_SECRET as the rest of the
 * app (simplest — one secret to rotate), but the `type` claim is what
 * actually keeps the two token kinds from crossing over. */
@Injectable()
export class PlatformAdminJwtStrategy extends PassportStrategy(Strategy, 'platform-admin-jwt') {
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

  async validate(payload: PlatformAdminJwtPayload) {
    if (payload.type !== 'platform-admin') {
      throw new UnauthorizedException('Not a platform-admin session.');
    }
    const admin = await this.prisma.platformAdmin.findUnique({ where: { id: payload.sub } });
    if (!admin) {
      throw new UnauthorizedException('Platform-admin account no longer exists.');
    }
    return { platformAdminId: admin.id, email: admin.email };
  }
}
