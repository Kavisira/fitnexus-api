import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { Screen } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionGuard } from '../auth/guards/permission.guard';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { CurrentUser, AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { FormsService } from './forms.service';
import { CreateFormTemplateDto } from './dto/create-form-template.dto';
import { GenerateFormLinkDto } from './dto/generate-form-link.dto';

/** Admin-side CRUD for form templates and their share links — the
 * public, unauthenticated fill-out/submit endpoints live in
 * PublicFormsController, kept as a separate controller so no guard
 * ever has to be conditionally skipped on a route here. */
@Controller('forms')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class FormsController {
  constructor(private formsService: FormsService) {}

  @Post('templates')
  @RequirePermission(Screen.FORMS, 'write')
  createTemplate(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateFormTemplateDto) {
    return this.formsService.createTemplate(user.organizationId, dto);
  }

  @Get('templates')
  @RequirePermission(Screen.FORMS, 'read')
  listTemplates(@CurrentUser() user: AuthenticatedUser) {
    return this.formsService.listTemplates(user.organizationId);
  }

  @Get('templates/:id')
  @RequirePermission(Screen.FORMS, 'read')
  getTemplate(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.formsService.getTemplate(user.organizationId, id);
  }

  @Post('templates/:id/links')
  @RequirePermission(Screen.FORMS, 'write')
  generateLink(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: GenerateFormLinkDto) {
    return this.formsService.generateShareLink(user.organizationId, id, dto.memberId, dto.sendWhatsapp ?? false);
  }

  @Get('templates/:id/submissions')
  @RequirePermission(Screen.FORMS, 'read')
  listSubmissions(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.formsService.listSubmissions(user.organizationId, id);
  }

  @Get('templates/:id/results')
  @RequirePermission(Screen.FORMS, 'read')
  getResults(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.formsService.getResultsSummary(user.organizationId, id);
  }
}
