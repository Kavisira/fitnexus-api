# FitNexus API

NestJS backend for FitNexus. Currently implements registration (with
dual email+phone OTP verification), login, and forgot-password (OTP +
reset) — matching the Angular auth flows in `fit-nexus/`.

## First-time setup

```bash
cd fit-nexus-api
npm install
cp .env.example .env
```

Edit `.env` and set `DATABASE_URL` to a real Postgres connection string.
For free local/dev hosting, use a free-tier Postgres from Supabase, Neon,
or Railway (see the "Tech Stack & Free Deployment Plan" doc from the
FitNexus project).

Then create the database tables:

```bash
npm run prisma:migrate -- --name init
npm run prisma:generate
```

## Run

```bash
npm run start:dev
```

The API listens on `http://localhost:3000/api` by default (see `PORT`
in `.env`). CORS is open to `http://localhost:4200` by default, matching
the Angular dev server.

## Endpoints (all under `/api/auth`)

- `POST /register` — `{ ownerName, organizationName, phone, email, password }` → creates a pending account, sends OTP to both email and phone (logged to the console for now — see `otp.service.ts` for where to plug in a real email/SMS provider).
- `POST /register/verify-otp` — `{ email, emailOtp, phoneOtp }` → verifies both codes, marks the account verified, returns a JWT.
- `POST /login` — `{ identifier, password }` (identifier = email or phone) → returns a JWT if credentials are valid and the account is verified.
- `POST /forgot-password` — `{ identifier }` → sends a reset OTP to whichever channel the identifier matches.
- `POST /forgot-password/verify-otp` — `{ identifier, otp }` → checks the code (doesn't consume it yet).
- `POST /forgot-password/reset` — `{ identifier, otp, newPassword }` → re-verifies and consumes the code, sets the new password.

Password rule (enforced both client-side in Angular and server-side via
`class-validator` here): at least 6 characters, one uppercase letter,
one lowercase letter, one number.

## Next steps

- Wire the Angular services (the `TODO` comments in `login.ts`,
  `signup.ts`, `forgot-password.ts`) to call these endpoints via
  `HttpClient`.
- Add an `environment.ts` in Angular for the API base URL.
- Swap the OTP console.log in `otp.service.ts` for a real provider
  (Resend/SendGrid for email, Twilio for SMS).
- Add guards + role checks as Branches/Members/Employees/Leads/
  Attendance modules are built (the sidenav routes already exist as
  placeholders in the Angular app).
