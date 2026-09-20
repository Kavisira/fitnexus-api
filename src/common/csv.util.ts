/** Minimal RFC4180-ish CSV parser — no external dependency needed for a
 * flat template like the Members/Employees bulk-import files (no nested
 * quoting edge cases beyond a quoted field containing a comma, a
 * newline, or an escaped "" for a literal quote). Kept dependency-free
 * deliberately: this environment can't always run `npm install` (see
 * repo notes on the sandboxed dev network), so adding a CSV library
 * would mean another manual package.json edit for every dev to pick up.
 *
 * Returns one string[] per row, including the header row — callers
 * split that off themselves (see rowsToObjects below). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  // Normalize line endings so \r\n and \r don't produce extra blank rows.
  const input = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  for (let i = 0; i < input.length; i++) {
    const char = input[i];

    if (inQuotes) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }

  // Final field/row (files don't always end with a trailing newline).
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  // Drop fully-blank trailing rows (common when a spreadsheet app adds
  // a trailing newline or empty rows at the end of the file).
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}

/** Maps parsed CSV rows (header + data rows) into plain objects keyed by
 * the header row's column names, trimmed. Extra/missing columns per row
 * are tolerated — missing cells become ''. */
export function rowsToObjects(rows: string[][]): Record<string, string>[] {
  if (rows.length === 0) {
    return [];
  }
  const headers = rows[0].map((h) => h.trim());
  return rows.slice(1).map((row) => {
    const obj: Record<string, string> = {};
    headers.forEach((header, i) => {
      obj[header] = (row[i] ?? '').trim();
    });
    return obj;
  });
}

/** Quotes a single CSV field only when needed (contains a comma, quote,
 * or newline) — used when building the downloadable template. */
export function csvField(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function buildCsv(headers: string[], rows: string[][]): string {
  const lines = [headers, ...rows].map((r) => r.map(csvField).join(','));
  return lines.join('\n') + '\n';
}
