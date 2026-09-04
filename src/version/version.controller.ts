import { Controller, Get } from '@nestjs/common';
import { readFileSync } from 'fs';
import { join } from 'path';

/** Server process start time, captured once at boot. */
const PROCESS_STARTED_AT = new Date().toISOString();

/** Read once at startup, not per-request — package.json doesn't change
 * while the process is running. process.cwd() is the project root both
 * locally (`npm run start:dev`) and on Render (its start command runs
 * from the service root), so this doesn't depend on dist/'s exact
 * folder depth the way a relative-to-__dirname path would. */
function readVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'));
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}
const APP_VERSION = readVersion();

/** Deliberately public (no JwtAuthGuard) — this is meant to be checked
 * from a "Deployed Version" menu item before/without being logged in
 * too (e.g. right after a deploy, to confirm it actually rolled out).
 * Reports the version number from package.json (bump it on every real
 * release — see the note in fit-nexus-api's package.json) rather than
 * a commit hash/branch, which isn't meaningful to non-technical staff
 * checking "did the update go live". */
@Controller('version')
export class VersionController {
  @Get()
  get() {
    return {
      version: APP_VERSION,
      startedAt: PROCESS_STARTED_AT,
    };
  }
}
