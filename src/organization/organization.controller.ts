import { Body, Controller, Delete, Get, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser, AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { OrganizationService } from './organization.service';
import { UploadLogoDto } from './dto/upload-logo.dto';

@Controller('organization')
@UseGuards(JwtAuthGuard)
export class OrganizationController {
  constructor(private organizationService: OrganizationService) {}

  @Get('me')
  mine(@CurrentUser() user: AuthenticatedUser) {
    return this.organizationService.mine(user);
  }

  // Owner-only, enforced in the service (see requireOwner).
  @Post('logo')
  uploadLogo(@CurrentUser() user: AuthenticatedUser, @Body() dto: UploadLogoDto) {
    return this.organizationService.uploadLogo(user, dto.logoDataUrl);
  }

  @Delete('logo')
  removeLogo(@CurrentUser() user: AuthenticatedUser) {
    return this.organizationService.removeLogo(user);
  }
}
