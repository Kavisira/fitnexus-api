/** Username/password generation for the "Create login" checkbox on
 * Employee create — see the schema comment on User.employeeId for the
 * shape this feeds. Kept as pure functions (no DB access) so they're
 * easy to unit test and reuse from the retroactive "create login for
 * an existing employee" action later. */

/** First 4 letters of the name, lowercased, letters only — shorter
 * names just use whatever letters exist (e.g. "Sam" -> "sam"). */
export function firstFourLetters(name: string): string {
  const lettersOnly = name.replace(/[^a-zA-Z]/g, '').toLowerCase();
  return lettersOnly.slice(0, 4);
}

/** DDMM from a date of birth, e.g. 1991-06-04 -> "0406". */
export function ddmm(date: Date): string {
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${day}${month}`;
}

/** Organization name -> lowercase alphanumeric slug for the email
 * domain part, e.g. "KingMaker Fitness" -> "kingmakerfitness". */
export function orgDomainSlug(organizationName: string): string {
  return organizationName.replace(/[^a-zA-Z0-9]/g, '').toLowerCase() || 'org';
}

/** Digits-only phone number, used verbatim as the auto-generated
 * initial password (staff can change it after first login). */
export function passwordFromPhone(phone: string): string {
  return phone.replace(/\D/g, '');
}

/** Builds the base username (before any de-dupe suffix) —
 * "arun0406@kingmaker.com" — from name + DOB + org name. */
export function buildBaseUsername(name: string, dateOfBirth: Date, organizationName: string): string {
  return `${firstFourLetters(name)}${ddmm(dateOfBirth)}@${orgDomainSlug(organizationName)}.com`;
}

/** Inserts a numeric de-dupe suffix right before the "@", e.g.
 * "arun0406@kingmaker.com" + 1 -> "arun04061@kingmaker.com". */
export function withSuffix(baseUsername: string, suffix: number): string {
  if (suffix <= 0) {
    return baseUsername;
  }
  const [local, domain] = baseUsername.split('@');
  return `${local}${suffix}@${domain}`;
}
