import { Controller, Get, Param, Post, Body } from '@nestjs/common';
import { FormsService } from './forms.service';
import { SubmitFormDto } from './dto/submit-form.dto';

/** Deliberately unauthenticated — the token in the URL IS the access
 * control (see the product discussion: token-only, no login/OTP for
 * the public form page). No JwtAuthGuard/PermissionGuard on this
 * controller at all, by design — see FormsController for the
 * admin-side equivalent that is guarded. */
@Controller('public/forms')
export class PublicFormsController {
  constructor(private formsService: FormsService) {}

  @Get(':token')
  getForm(@Param('token') token: string) {
    return this.formsService.getPublicForm(token);
  }

  @Post(':token/submit')
  submit(@Param('token') token: string, @Body() dto: SubmitFormDto) {
    return this.formsService.submitPublicForm(token, dto);
  }
}
