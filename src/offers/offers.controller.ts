import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { Screen } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionGuard } from '../auth/guards/permission.guard';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { CurrentUser, AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { OffersService } from './offers.service';
import { CreateOfferDto } from './dto/create-offer.dto';
import { UpdateOfferDto } from './dto/update-offer.dto';

// Offers are part of Plans management — gated by the same PLANS screen
// permission rather than a separate one. Independent, org-wide catalog:
// no branchId/planId scoping on any of these endpoints.
@Controller('offers')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class OffersController {
  constructor(private offersService: OffersService) {}

  @Post()
  @RequirePermission(Screen.PLANS, 'write')
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateOfferDto) {
    return this.offersService.create(user.organizationId, dto);
  }

  @Get()
  @RequirePermission(Screen.PLANS, 'read')
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.offersService.findAll(user.organizationId);
  }

  @Patch(':id')
  @RequirePermission(Screen.PLANS, 'write')
  update(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: UpdateOfferDto) {
    return this.offersService.update(user.organizationId, id, dto);
  }

  @Delete(':id')
  @RequirePermission(Screen.PLANS, 'write')
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.offersService.remove(user.organizationId, id);
  }
}
