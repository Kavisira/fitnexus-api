import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { RolesService } from '../roles/roles.service';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { CreateEmployeeActivityDto } from './dto/create-employee-activity.dto';
import { SalaryComponentDto } from './dto/salary-component.dto';
import { buildBaseUsername, passwordFromPhone, withSuffix } from './employee-login.util';
import { decryptSecret, encryptSecret } from './credentials-crypto.util';
import { parseCsv, rowsToObjects } from '../common/csv.util';

const IMPORT_ROW_CAP = 1000;
const STATUSES = ['ACTIVE', 'INACTIVE'];
// Every org starts with these four job titles seeded (see
// ensureJobTitlesSeeded) — an org can add more of its own from there.
const DEFAULT_JOB_TITLES = ['Manager', 'Trainer', 'Front Desk', 'Other'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const BRANCH_SELECT = { id: true, location: true };
const SALT_ROUNDS = 10;

// Every employee is login-eligible now, whatever their job title —
// the three names below (matched case-insensitively) map to the
// permission role the Role Permissions matrix actually governs;
// anything else (a custom title, or "Other") falls back to the
// generic STAFF role, which still gets a real login but no entry in
// that matrix (so it starts with the least access, same idea as an
// unconfigured role).
const NAMED_LOGIN_ROLE: Record<string, UserRole> = {
  MANAGER: UserRole.BRANCH_MANAGER,
  TRAINER: UserRole.TRAINER,
  'FRONT DESK': UserRole.FRONT_DESK,
};

function resolveUserRole(jobTitle: string): UserRole {
  return NAMED_LOGIN_ROLE[jobTitle.trim().toUpperCase()] ?? UserRole.STAFF;
}

export interface EmployeeListFilters {
  branchId?: string;
  role?: string;
  status?: string;
  search?: string;
}

@Injectable()
export class EmployeesService {
  constructor(
    private prisma: PrismaService,
    private rolesService: RolesService,
    private config: ConfigService,
  ) {}

  /** Same fallback chain as JwtStrategy — reuses JWT_SECRET rather than
   * requiring a brand-new env var, since this is dev-friendly and the
   * two secrets don't need to be independently rotated for this app's
   * threat model. Set CREDENTIALS_ENC_SECRET explicitly in production
   * if you want them separate. */
  private encryptionSecret(): string {
    return (
      this.config.get<string>('CREDENTIALS_ENC_SECRET') ??
      this.config.get<string>('JWT_SECRET') ??
      'change-me-in-production'
    );
  }

  /** Same tenant-isolation pattern as LeadsService.assertBranchInOrg. */
  private async assertBranchInOrg(organizationId: string, branchId: string) {
    const branch = await this.prisma.branch.findFirst({ where: { id: branchId, organizationId } });
    if (!branch) {
      throw new NotFoundException('Branch not found.');
    }
  }

  /** Generates a unique username by trying the base form, then
   * appending 1, 2, 3... on collision (see employee-login.util). */
  private async generateUniqueUsername(name: string, dateOfBirth: Date, organizationName: string): Promise<string> {
    const base = buildBaseUsername(name, dateOfBirth, organizationName);
    let candidate = base;
    let suffix = 0;
    // Bounded loop — a runaway collision chain would indicate something
    // else is wrong, not a legitimate case to loop forever on.
    while (suffix < 1000) {
      const existing = await this.prisma.user.findUnique({ where: { email: candidate } });
      if (!existing) {
        return candidate;
      }
      suffix += 1;
      candidate = withSuffix(base, suffix);
    }
    throw new ConflictException('Could not generate a unique username — please try again.');
  }

  async create(organizationId: string, dto: CreateEmployeeDto) {
    await this.assertBranchInOrg(organizationId, dto.branchId);

    if (dto.createLogin && !dto.dateOfBirth) {
      throw new BadRequestException('Date of birth is required to create a login.');
    }

    // Any job title typed here — including a brand-new one — joins the
    // org's managed list for next time (see ensureJobTitle); CSV import
    // goes through this same path via bulkCreate() -> create().
    const role = dto.role ?? 'OTHER';
    await this.ensureJobTitle(organizationId, role);

    const employee = await this.prisma.employee.create({
      data: {
        organizationId,
        branchId: dto.branchId,
        name: dto.name,
        phone: dto.phone,
        email: dto.email,
        photoUrl: dto.photoUrl,
        role,
        joinDate: new Date(dto.joinDate),
        dateOfBirth: dto.dateOfBirth ? new Date(dto.dateOfBirth) : undefined,
        basicPay: dto.basicPay,
        // New employees start with an empty salary structure (no
        // role/branch template — see the SalaryComponent model comment)
        // unless the caller already sent a list (e.g. CSV import never
        // does, but a future "copy" convenience could).
        salaryComponents: dto.components
          ? { createMany: { data: dto.components.map((c) => this.toSalaryComponentData(c)) } }
          : undefined,
      },
      include: { branch: { select: BRANCH_SELECT }, salaryComponents: true },
    });

    if (!dto.createLogin) {
      return { employee, login: null };
    }

    const login = await this.createLoginForEmployee(organizationId, employee.id);
    return { employee, login };
  }

  /** Job titles: a per-org managed list (see the JobTitle model doc
   * comment) backing the Employees form's role dropdown. */

  async ensureJobTitlesSeeded(organizationId: string): Promise<void> {
    const count = await this.prisma.jobTitle.count({ where: { organizationId } });
    if (count > 0) return;
    await this.prisma.jobTitle.createMany({
      data: DEFAULT_JOB_TITLES.map((name) => ({ organizationId, name })),
      skipDuplicates: true,
    });
  }

  async listJobTitles(organizationId: string) {
    await this.ensureJobTitlesSeeded(organizationId);
    return this.prisma.jobTitle.findMany({ where: { organizationId }, orderBy: { name: 'asc' } });
  }

  /** Converts a validated SalaryComponentDto into Prisma create input,
   * clamping percent to a sane 0-100 range (class-validator's
   * @IsNumberString only checks it parses as a number, not its range). */
  private toSalaryComponentData(dto: SalaryComponentDto): Prisma.SalaryComponentCreateManyEmployeeInput {
    const percent = Number(dto.percent);
    if (Number.isNaN(percent) || percent < 0 || percent > 100) {
      throw new BadRequestException(`Salary component "${dto.name}" percent must be between 0 and 100.`);
    }
    return { name: dto.name.trim(), type: dto.type, percent };
  }

  /** Adds `name` to the org's job title list if it isn't there yet —
   * used both by the explicit "+ create new" action and silently
   * whenever create()/bulkCreate() sees a title that doesn't exist yet
   * (e.g. a CSV import), so the list always reflects every title
   * actually in use. */
  async ensureJobTitle(organizationId: string, name: string) {
    const trimmed = name.trim();
    if (!trimmed) {
      throw new BadRequestException('Job title cannot be empty.');
    }
    await this.ensureJobTitlesSeeded(organizationId);
    return this.prisma.jobTitle.upsert({
      where: { organizationId_name: { organizationId, name: trimmed } },
      create: { organizationId, name: trimmed },
      update: {},
    });
  }

  /** Shared by create() (checkbox) and the standalone "create login for
   * an existing employee" action. Generates username/password, creates
   * the User row, and returns the plaintext credentials once so the
   * caller can show them to the admin — they're never retrievable again
   * after this (only the bcrypt hash is stored). */
  async createLoginForEmployee(organizationId: string, employeeId: string) {
    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, organizationId },
      include: { user: true, organization: { select: { name: true } } },
    });
    if (!employee) {
      throw new NotFoundException('Employee not found.');
    }
    if (employee.user) {
      throw new ConflictException('This employee already has a login.');
    }
    if (!employee.dateOfBirth) {
      throw new BadRequestException('Date of birth is required to create a login.');
    }
    const userRole = resolveUserRole(employee.role);

    const username = await this.generateUniqueUsername(employee.name, employee.dateOfBirth, employee.organization.name);
    const password = passwordFromPhone(employee.phone);
    if (!password) {
      throw new BadRequestException('This employee has no usable phone number to generate a password from.');
    }
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const passwordEnc = encryptSecret(password, this.encryptionSecret());

    // Seed the permission matrix ahead of the login existing, so the
    // very first request this account makes already has rows to check
    // against instead of racing the lazy-seed in RolesService.can.
    await this.rolesService.ensureSeeded(organizationId);

    try {
      await this.prisma.user.create({
        data: {
          organizationId,
          employeeId: employee.id,
          branchId: employee.branchId,
          role: userRole,
          name: employee.name,
          email: username,
          phone: password, // digits-only phone, doubles as the User.phone identifier
          password: passwordHash,
          passwordEnc,
          // Admin-created staff logins are trusted immediately — no OTP
          // step, unlike the owner's self-service signup flow.
          emailVerifiedAt: new Date(),
          phoneVerifiedAt: new Date(),
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException(
          'Could not create a login — this phone number is already used by another account.',
        );
      }
      throw err;
    }

    return { username, password };
  }

  /** Owner-only — lets the owner look up a staff login's username and
   * password from the employee's detail screen at any time, not just
   * the one-time reveal right after creation. Gated on role here
   * (not the permission matrix, which only ever governs Trainer/
   * Manager/Front Desk) since this is sensitive regardless of what the
   * matrix says about the Employees screen. */
  async getCredentials(organizationId: string, employeeId: string, requestingUserRole: UserRole) {
    if (requestingUserRole !== UserRole.OWNER) {
      throw new ForbiddenException('Only the owner can view a staff login’s credentials.');
    }

    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, organizationId },
      include: { user: true },
    });
    if (!employee) {
      throw new NotFoundException('Employee not found.');
    }
    if (!employee.user) {
      throw new NotFoundException('This employee has no login yet.');
    }
    if (!employee.user.passwordEnc) {
      // Logins created before this field existed have no recoverable
      // password — only their bcrypt hash. Retroactive reset (a future
      // "reset password" action) would be the way to give this employee
      // a viewable password again.
      throw new NotFoundException(
        'This login was created before passwords became recoverable — use "Reset password" to set a new one.',
      );
    }

    const password = decryptSecret(employee.user.passwordEnc, this.encryptionSecret());
    return { username: employee.user.email, password };
  }

  findAll(organizationId: string, filters: EmployeeListFilters) {
    return this.prisma.employee.findMany({
      where: {
        organizationId,
        ...(filters.branchId ? { branchId: filters.branchId } : {}),
        ...(filters.role ? { role: filters.role as any } : {}),
        ...(filters.status ? { status: filters.status as any } : {}),
        ...(filters.search
          ? {
              OR: [
                { name: { contains: filters.search, mode: 'insensitive' as const } },
                { phone: { contains: filters.search, mode: 'insensitive' as const } },
                { email: { contains: filters.search, mode: 'insensitive' as const } },
              ],
            }
          : {}),
      },
      include: {
        branch: { select: BRANCH_SELECT },
        activities: { orderBy: { createdAt: 'desc' }, take: 4 },
        user: { select: { id: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(organizationId: string, id: string) {
    const employee = await this.prisma.employee.findFirst({
      where: { id, organizationId },
      include: {
        branch: { select: BRANCH_SELECT },
        activities: { orderBy: { createdAt: 'desc' } },
        user: { select: { id: true, email: true } },
        salaryComponents: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!employee) {
      throw new NotFoundException('Employee not found.');
    }
    return employee;
  }

  async update(organizationId: string, id: string, dto: UpdateEmployeeDto) {
    const employee = await this.prisma.employee.findFirst({ where: { id, organizationId } });
    if (!employee) {
      throw new NotFoundException('Employee not found.');
    }

    if (dto.branchId && dto.branchId !== employee.branchId) {
      await this.assertBranchInOrg(organizationId, dto.branchId);
    }

    if (dto.role) {
      await this.ensureJobTitle(organizationId, dto.role);
    }

    return this.prisma.$transaction(async (tx) => {
      // dto.components undefined -> leave the existing list untouched;
      // an empty array is a deliberate "clear everything" (see the DTO
      // doc comment) — both are distinct from "field not sent" here.
      if (dto.components) {
        await tx.salaryComponent.deleteMany({ where: { employeeId: id } });
      }

      return tx.employee.update({
        where: { id },
        data: {
          name: dto.name,
          phone: dto.phone,
          email: dto.email,
          branchId: dto.branchId,
          role: dto.role,
          status: dto.status,
          joinDate: dto.joinDate ? new Date(dto.joinDate) : undefined,
          dateOfBirth: dto.dateOfBirth === undefined ? undefined : dto.dateOfBirth ? new Date(dto.dateOfBirth) : null,
          photoUrl: dto.photoUrl,
          basicPay: dto.basicPay === undefined ? undefined : dto.basicPay,
          salaryComponents: dto.components
            ? { createMany: { data: dto.components.map((c) => this.toSalaryComponentData(c)) } }
            : undefined,
        },
        include: { branch: { select: BRANCH_SELECT }, salaryComponents: true },
      });
    });
  }

  async remove(organizationId: string, id: string) {
    const employee = await this.prisma.employee.findFirst({ where: { id, organizationId } });
    if (!employee) {
      throw new NotFoundException('Employee not found.');
    }
    return this.prisma.employee.delete({ where: { id } });
  }

  async addActivity(organizationId: string, employeeId: string, dto: CreateEmployeeActivityDto) {
    const employee = await this.prisma.employee.findFirst({ where: { id: employeeId, organizationId } });
    if (!employee) {
      throw new NotFoundException('Employee not found.');
    }
    return this.prisma.employeeActivity.create({ data: { employeeId, note: dto.note } });
  }

  // ---- Bulk import (CSV) — same two-step parse-then-commit shape as
  // MembersService, minus the "assign in batches" step: Role and
  // BranchId are plain values a spreadsheet cell can hold directly, so
  // there's nothing here that needs a post-parse assignment screen.
  // Photo and createLogin are deliberately excluded from bulk import —
  // a photo can't come from a CSV cell, and auto-generating a login
  // (and exposing its password in a results file) for a whole batch at
  // once is a security smell; both stay one-by-one actions. ----

  async parseImportCsv(organizationId: string, dto: { branchId: string; csvContent: string }) {
    await this.assertBranchInOrg(organizationId, dto.branchId);

    const parsedRows = rowsToObjects(parseCsv(dto.csvContent));
    if (parsedRows.length === 0) {
      throw new BadRequestException('The CSV file has no data rows.');
    }
    if (parsedRows.length > IMPORT_ROW_CAP) {
      throw new BadRequestException(`This file has ${parsedRows.length} rows — the maximum per import is ${IMPORT_ROW_CAP}. Split it into smaller files.`);
    }

    const phones = parsedRows.map((r) => r['Phone']).filter(Boolean);
    const emails = parsedRows.map((r) => r['Email']).filter(Boolean);
    const existing = await this.prisma.employee.findMany({
      where: {
        organizationId,
        branchId: dto.branchId,
        OR: [...(phones.length ? [{ phone: { in: phones } }] : []), ...(emails.length ? [{ email: { in: emails } }] : [])],
      },
      select: { phone: true, email: true },
    });
    const existingPhones = new Set(existing.map((e) => e.phone));
    const existingEmails = new Set(existing.map((e) => e.email).filter((e): e is string => !!e));
    const seenPhones = new Set<string>();
    const seenEmails = new Set<string>();

    return {
      rows: parsedRows.map((raw, i) => {
        const errors: string[] = [];
        const name = raw['Name'] ?? '';
        const phone = raw['Phone'] ?? '';
        const email = raw['Email'] || undefined;
        // Free-form now — matched against (or added to) the org's job
        // title list in create(), not a fixed set of allowed values.
        const role = raw['Role']?.trim() || undefined;
        const joinDate = raw['JoinDate'] || undefined;
        const dateOfBirth = raw['DateOfBirth'] || undefined;
        const basicPay = raw['BasicPay'] || undefined;

        if (name.trim().length < 2) errors.push('Name is required (at least 2 characters).');
        if (phone.trim().length < 5) errors.push('Phone is required (at least 5 characters).');
        if (email && !EMAIL_RE.test(email)) errors.push('Email is not a valid address.');
        if (!joinDate || !DATE_RE.test(joinDate)) errors.push('JoinDate is required, in YYYY-MM-DD format.');
        if (dateOfBirth && !DATE_RE.test(dateOfBirth)) errors.push('DateOfBirth must be in YYYY-MM-DD format.');
        if (role && role.length > 60) errors.push('Role must be 60 characters or fewer.');
        if (basicPay && isNaN(Number(basicPay))) errors.push('BasicPay must be a number.');

        if (phone) {
          if (existingPhones.has(phone)) errors.push('Phone already belongs to an existing employee in this branch.');
          else if (seenPhones.has(phone)) errors.push('Phone is duplicated elsewhere in this file.');
          seenPhones.add(phone);
        }
        if (email) {
          if (existingEmails.has(email)) errors.push('Email already belongs to an existing employee in this branch.');
          else if (seenEmails.has(email)) errors.push('Email is duplicated elsewhere in this file.');
          seenEmails.add(email);
        }

        return {
          rowNumber: i + 2,
          data: { name, phone, email, role, joinDate, dateOfBirth, basicPay },
          errors,
        };
      }),
    };
  }

  async bulkCreate(organizationId: string, rows: CreateEmployeeDto[]) {
    if (rows.length > IMPORT_ROW_CAP) {
      throw new BadRequestException(`This request has ${rows.length} rows — the maximum per import is ${IMPORT_ROW_CAP}.`);
    }

    const results: { rowNumber: number; success: boolean; employeeId?: string; error?: string }[] = [];
    for (let i = 0; i < rows.length; i++) {
      try {
        // Bulk-imported rows never create a login, regardless of what's
        // in the DTO — see the class doc comment above.
        const { employee } = await this.create(organizationId, { ...rows[i], createLogin: false });
        results.push({ rowNumber: i + 2, success: true, employeeId: employee.id });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to create this employee.';
        results.push({ rowNumber: i + 2, success: false, error: message });
      }
    }
    return { results };
  }
}
