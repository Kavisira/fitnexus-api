import { Controller, Get } from '@nestjs/common';

/** Server process start time, captured once at boot — the closest proxy
 * we have to "when this instance was actually deployed" without needing
 * a build step on the backend (unlike the frontend, Render runs the
 * TypeScript source directly, there's no separate build artifact to
 * stamp a build time onto). Good enough to answer "is this actually the
 * new deploy or an old instance still running" during a rollout. */
const PROCESS_STARTED_AT = new Date().toISOString();

/** Deliberately public (no JwtAuthGuard) — this is meant to be checked
 * from a "Deployed Version" menu item before/without being logged in
 * too (e.g. right after a deploy, to confirm it actually rolled out),
 * and it reveals nothing sensitive: just which commit/branch is live. */
@Controller('version')
export class VersionController {
  @Get()
  get() {
    return {
      // Render sets these automatically on every deployed service — see
      // https://render.com/docs/environment-variables#all-services.
      // Empty/undefined when run locally outside Render (e.g. `npm run
      // start:dev`), which is fine — the frontend just shows "local dev".
      commitHash: process.env.RENDER_GIT_COMMIT ?? null,
      branch: process.env.RENDER_GIT_BRANCH ?? null,
      serviceName: process.env.RENDER_SERVICE_NAME ?? null,
      startedAt: PROCESS_STARTED_AT,
      nodeEnv: process.env.NODE_ENV ?? 'development',
    };
  }
}
