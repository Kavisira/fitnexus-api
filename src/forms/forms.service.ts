import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { ConfigService } from '@nestjs/config';
import * as QRCode from 'qrcode';
import { FormFieldType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { CreateFormTemplateDto } from './dto/create-form-template.dto';
import { SubmitFormDto, FormAnswerInputDto } from './dto/submit-form.dto';

const CHOICE_TYPES = new Set<FormFieldType>([FormFieldType.SINGLE_CHOICE, FormFieldType.MULTI_CHOICE]);

@Injectable()
export class FormsService {
  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private whatsapp: WhatsappService,
  ) {}

  // ── Admin (authenticated) side ──────────────────────────────────

  async createTemplate(organizationId: string, dto: CreateFormTemplateDto) {
    return this.prisma.formTemplate.create({
      data: {
        organizationId,
        name: dto.name,
        description: dto.description,
        fields: {
          create: dto.fields.map((f, index) => ({
            label: f.label,
            type: f.type,
            required: f.required ?? false,
            // Only persist options for choice fields — see the DTO's
            // comment; a stray options list on e.g. a RATING field is
            // dropped rather than erroring, since the admin UI never
            // sends one for non-choice types anyway.
            options: CHOICE_TYPES.has(f.type) ? (f.options ?? []) : [],
            order: f.order ?? index,
          })),
        },
      },
      include: { fields: { orderBy: { order: 'asc' } } },
    });
  }

  async listTemplates(organizationId: string) {
    return this.prisma.formTemplate.findMany({
      where: { organizationId },
      include: { fields: { orderBy: { order: 'asc' } }, _count: { select: { shareLinks: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getTemplate(organizationId: string, id: string) {
    const template = await this.prisma.formTemplate.findFirst({
      where: { id, organizationId },
      include: { fields: { orderBy: { order: 'asc' } } },
    });
    if (!template) {
      throw new NotFoundException('Form template not found.');
    }
    return template;
  }

  /** Generates a fresh, single-use, member-tied share link for a
   * template. Always a new link — see the product discussion: links
   * are never reused across sends, only the template itself can be
   * reused. Returns the raw token so the caller (controller) can build
   * the public URL and, separately, hand it to WhatsappService/QR. */
  async generateShareLink(organizationId: string, formTemplateId: string, memberId: string, sendWhatsapp = false) {
    const template = await this.getTemplate(organizationId, formTemplateId);

    const member = await this.prisma.member.findFirst({ where: { id: memberId, organizationId } });
    if (!member) {
      throw new NotFoundException('Member not found.');
    }

    const token = randomBytes(24).toString('base64url');
    const link = await this.prisma.formShareLink.create({
      data: { organizationId, formTemplateId, memberId, token },
    });

    const publicUrl = this.buildPublicUrl(token);
    const qrCodeDataUrl = await QRCode.toDataURL(publicUrl, { margin: 1, width: 320 });

    if (sendWhatsapp) {
      // Fire-and-forget, fails soft — see WhatsappService.sendFormLink.
      void this.whatsapp.sendFormLink(member.phone, member.name, template.name, publicUrl);
    }

    return { ...link, publicUrl, qrCodeDataUrl };
  }

  private buildPublicUrl(token: string): string {
    const base = this.config.get<string>('FRONTEND_PUBLIC_URL')?.trim().replace(/\/$/, '') || 'http://localhost:4200';
    return `${base}/public-forms/${token}`;
  }

  async listSubmissions(organizationId: string, formTemplateId: string) {
    await this.getTemplate(organizationId, formTemplateId);
    return this.prisma.formSubmission.findMany({
      where: { formShareLink: { formTemplateId, organizationId } },
      include: {
        answers: true,
        formShareLink: { include: { member: { select: { id: true, name: true, phone: true } } } },
      },
      orderBy: { submittedAt: 'desc' },
    });
  }

  /** Average rating + response count per form, plus a per-option
   * frequency breakdown for choice fields — the results view the
   * product discussion asked for. Computed on read rather than kept
   * as a running counter, since submission volume per form is small
   * (one per member) and this keeps the write path simple. */
  async getResultsSummary(organizationId: string, formTemplateId: string) {
    const template = await this.getTemplate(organizationId, formTemplateId);
    const submissions = await this.listSubmissions(organizationId, formTemplateId);

    const byField = new Map(template.fields.map((f) => [f.id, f]));
    const summary: Record<
      string,
      { fieldId: string; label: string; type: FormFieldType; average?: number; count: number; optionCounts?: Record<string, number> }
    > = {};

    for (const field of template.fields) {
      summary[field.id] = { fieldId: field.id, label: field.label, type: field.type, count: 0 };
      if (CHOICE_TYPES.has(field.type)) {
        summary[field.id].optionCounts = Object.fromEntries(field.options.map((o) => [o, 0]));
      }
    }

    for (const submission of submissions) {
      for (const answer of submission.answers) {
        const entry = summary[answer.formFieldId];
        const field = byField.get(answer.formFieldId);
        if (!entry || !field) continue;
        entry.count += 1;

        if (field.type === FormFieldType.RATING || field.type === FormFieldType.NUMBER) {
          const value = answer.numberValue ? Number(answer.numberValue) : undefined;
          if (value !== undefined) {
            entry.average = entry.average === undefined ? value : entry.average + value;
          }
        } else if (CHOICE_TYPES.has(field.type) && entry.optionCounts) {
          for (const choice of answer.choiceValues) {
            if (choice in entry.optionCounts) {
              entry.optionCounts[choice] += 1;
            }
          }
        }
      }
    }

    // Convert running totals into real averages.
    for (const entry of Object.values(summary)) {
      if (entry.average !== undefined && entry.count > 0) {
        entry.average = Math.round((entry.average / entry.count) * 100) / 100;
      }
    }

    return { totalSubmissions: submissions.length, fields: Object.values(summary) };
  }

  // ── Public (unauthenticated) side ───────────────────────────────

  /** Loads the form a public link points at, or throws if the token is
   * unknown or already used. Never leaks which org/member it belongs
   * to beyond what's needed to render the form. */
  async getPublicForm(token: string) {
    const link = await this.prisma.formShareLink.findUnique({
      where: { token },
      include: { formTemplate: { include: { fields: { orderBy: { order: 'asc' } } } } },
    });
    if (!link) {
      throw new NotFoundException('This link is invalid.');
    }
    if (link.usedAt) {
      throw new ForbiddenException('This form has already been submitted.');
    }
    return {
      templateName: link.formTemplate.name,
      description: link.formTemplate.description,
      fields: link.formTemplate.fields.map((f) => ({
        id: f.id,
        label: f.label,
        type: f.type,
        required: f.required,
        options: f.options,
      })),
    };
  }

  async submitPublicForm(token: string, dto: SubmitFormDto) {
    const link = await this.prisma.formShareLink.findUnique({
      where: { token },
      include: { formTemplate: { include: { fields: true } } },
    });
    if (!link) {
      throw new NotFoundException('This link is invalid.');
    }
    if (link.usedAt) {
      throw new ForbiddenException('This form has already been submitted.');
    }

    const fieldsById = new Map(link.formTemplate.fields.map((f) => [f.id, f]));
    const answeredFieldIds = new Set(dto.answers.map((a) => a.formFieldId));

    for (const field of link.formTemplate.fields) {
      if (field.required && !answeredFieldIds.has(field.id)) {
        throw new BadRequestException(`"${field.label}" is required.`);
      }
    }
    for (const answer of dto.answers) {
      if (!fieldsById.has(answer.formFieldId)) {
        throw new BadRequestException('Submitted an answer for a field that is not on this form.');
      }
    }

    // Single-use enforcement + the submission itself happen in one
    // transaction, closing the race where two concurrent submits on
    // the same token could both slip through between a plain check
    // and a later write.
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.formShareLink.findUnique({ where: { token } });
      if (!current || current.usedAt) {
        throw new ForbiddenException('This form has already been submitted.');
      }

      await tx.formShareLink.update({ where: { token }, data: { usedAt: new Date() } });

      return tx.formSubmission.create({
        data: {
          formShareLinkId: link.id,
          answers: {
            create: dto.answers.map((a: FormAnswerInputDto) => {
              const field = fieldsById.get(a.formFieldId)!;
              return {
                formFieldId: a.formFieldId,
                textValue:
                  field.type === FormFieldType.SHORT_TEXT ||
                  field.type === FormFieldType.LONG_TEXT ||
                  field.type === FormFieldType.DATE
                    ? a.textValue
                    : undefined,
                numberValue:
                  field.type === FormFieldType.RATING || field.type === FormFieldType.NUMBER ? a.numberValue : undefined,
                booleanValue: field.type === FormFieldType.YES_NO ? a.booleanValue : undefined,
                choiceValues: CHOICE_TYPES.has(field.type) ? (a.choiceValues ?? []) : [],
              };
            }),
          },
        },
        include: { answers: true },
      });
    });
  }
}
