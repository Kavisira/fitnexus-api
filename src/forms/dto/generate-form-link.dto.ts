import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class GenerateFormLinkDto {
  @IsString()
  memberId!: string;

  // When true, also sends the link to the member over WhatsApp (needs
  // an approved WHATSAPP_TEMPLATE_FORM_LINK template — see
  // WhatsappService.sendFormLink; fails soft like every other
  // WhatsApp send, so this never blocks link generation itself).
  // Defaults to false — the admin UI can instead just show the QR
  // code/link for the owner to share however they like (print, show
  // on a desk tablet, etc.).
  @IsOptional()
  @IsBoolean()
  sendWhatsapp?: boolean;
}
