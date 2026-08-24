import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { RolesService } from '../roles/roles.service';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { CreateEmployeeActivityDto } from './dto/create-employee-activity.dto';
import { buildBaseUsername, passwordFromPhone, withSuffix } from './employee-login.util';
import { decryptSecret, encryptSecret } from './credentials-crypto.util';

const BRANCH_SELECT = { id: true, location: true };
const SALT_ROUNDS = 10;

// Only these Employee roles are entitled to a staff login for now — a
// plain "Other" record is data-only, matching the roles/permissions
// scoping discussion (Trainer/Manager/Front Desk are the three roles
// the permission matrix actually governs).
const LOGIN_ELIGIBLE_ROLE: Record<string, UserRole> = {
  MANAGER: UserRole.BRANCH_MANAGER,
  TRAINER: UserRole.TRAINER,
  FRONT_DESK: UserRole.FRONT_DESK,
};

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

    if (dto.createLogin) {
      if (!dto.dateOfBirth) {
        throw new BadRequestException('Date of birth is required to create a login.');
      }
      if (!LOGIN_ELIGIBLE_ROLE[dto.role ?? 'OTHER']) {
        throw new BadRequestException('Only Manager, Trainer, or Front Desk roles can have a login.');
      }
    }

    const employee = await this.prisma.employee.create({
      data: {
        organizationId,
        branchId: dto.branchId,
        name: dto.name,
        phone: dto.phone,
        email: dto.email,
        photoUrl: dto.photoUrl,
        role: dto.role ?? 'OTHER',
        joinDate: new Date(dto.joinDate),
        dateOfBirth: dto.dateOfBirth ? new Date(dto.dateOfBirth) : undefined,
        basicPay: dto.basicPay,
      },
      include: { branch: { select: BRANCH_SELECT } },
    });

    if (!dto.createLogin) {
      return { employee, login: null };
    }

    const login = await this.createLoginForEmployee(organizationId, employee.id);
    return { employee, login };
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
    const userRole = LOGIN_ELIGIBLE_ROLE[employee.role];
    if (!userRole) {
      throw new BadRequestException('Only Manager, Trainer, or Front Desk roles can have a login.');
    }

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

    return this.prisma.employee.update({
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
      },
      include: { branch: { select: BRANCH_SELECT } },
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
}
