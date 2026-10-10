/**
 * Canonicalizes a phone number for storage/lookup so the same real
 * number always compares equal regardless of how it was typed —
 * "+1 555-629-2767", "1 (555) 629-2767", and "15556292767" all become
 * "15556292767". This is deliberately NOT the same normalization as
 * WhatsappService.normalizePhone (which assumes India/91 for bare
 * 10-digit numbers for WhatsApp delivery specifically) — this one is
 * country-agnostic since User.phone has no notion of a default country.
 *
 * Used everywhere a phone number is written to or matched against the
 * User table (register, login, forgot-password) so User.phone is
 * always stored and queried in this one canonical shape.
 */
export function normalizePhone(raw: string): string {
  return raw.replace(/\D/g, '');
}
