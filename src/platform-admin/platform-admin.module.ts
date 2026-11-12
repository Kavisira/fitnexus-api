import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PlatformAdminController } from './platform-admin.controller';
import { PlatformAdminService } from './platform-admin.service';
import { PlatformAdminJwtStrategy } from './strategies/platform-admin-jwt.strategy';

// Deliberately does NOT import AuthModule or anything tenant-scoped —
// this module's only shared dependency is PrismaModule (global).
// JwtModule is registered AGAIN here (same pattern as AuthModule) with
// the same JWT_SECRET, rather than relying on AppModule's own
// registration — @nestjs/jwt's JwtModule isn't `global: true` there, so
// JwtService isn't actually injectable outside the module that
// registers it. Signing uses the shared secret; the `type:
// 'platform-admin'` claim (not a different secret) is what keeps this
// token kind from being usable on a tenant route — see
// PlatformAdminJwtStrategy.
@Module({
  imports: [
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET') ?? 'change-me-in-production',
      }),
    }),
  ],
  controllers: [PlatformAdminController],
  providers: [PlatformAdminService, PlatformAdminJwtStrategy],
})
export class PlatformAdminModule {}
