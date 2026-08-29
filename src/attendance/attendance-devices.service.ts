import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { BiometricVendorType, PunchPersonType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateDeviceDto } from './dto/create-device.dto';
import { UpdateDeviceDto } from './dto/update-device.dto';
import { UpsertEnrollmentDto } from './dto/upsert-enrollment.dto';

@Injectable()
export class AttendanceDevicesService {
  constructor(private prisma: PrismaService) {}

  private async assertBranch(organizationId: string, branchId: string) {
    const branch = await this.prisma.branch.findFirst({ where: { id: branchId, organizationId } });
    if (!branch) {
      throw new NotFoundException('Branch not found.');
    }
  }

  async create(organizationId: string, dto: CreateDeviceDto) {
    await this.assertBranch(organizationId, dto.branchId);
    if (dto.vendorType === BiometricVendorType.ADMS_PUSH) {
      const existing = await this.prisma.biometricDevice.findFirst({ where: { organizationId, serialNumber: dto.serialNumber } });
      if (existing) {
        throw new BadRequestException('A device with this serial number is already registered.');
      }
    }
    return this.prisma.biometricDevice.create({
      data: {
        organizationId,
        branchId: dto.branchId,
        name: dto.name,
        vendorType: dto.vendorType,
        serialNumber: dto.vendorType === BiometricVendorType.ADMS_PUSH ? dto.serialNumber : null,
      },
    });
  }

  findAll(organizationId: string, branchId?: string) {
    return this.prisma.biometricDevice.findMany({
      where: { organizationId, ...(branchId ? { branchId } : {}) },
      include: { branch: { select: { id: true, location: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(organizationId: string, id: string) {
    const device = await this.prisma.biometricDevice.findFirst({ where: { id, organizationId } });
    if (!device) {
      throw new NotFoundException('Device not found.');
    }
    return device;
  }

  async update(organizationId: string, id: string, dto: UpdateDeviceDto) {
    await this.findOne(organizationId, id);
    return this.prisma.biometricDevice.update({ where: { id }, data: { name: dto.name } });
  }

  async remove(organizationId: string, id: string) {
    await this.findOne(organizationId, id);
    await this.prisma.biometricDevice.delete({ where: { id } });
    return { success: true };
  }

  /** Rotates the GENERIC_WEBHOOK apiKey — same idea as regenerating an
   * API token when a device/bridge might have been misconfigured or a
   * key leaked into a client's own logs. */
  async rotateApiKey(organizationId: string, id: string) {
    const device = await this.findOne(organizationId, id);
    return this.prisma.biometricDevice.update({
      where: { id: device.id },
      // A fresh UUID stands in for the new key — doesn't need to be a
      // cuid like the auto-generated default, just unique and opaque.
      data: { apiKey: randomUUID() },
    });
  }

  // ---- Enrollment: mapping a device's raw biometricUserId to a person ----

  listEnrollments(organizationId: string, deviceId: string) {
    return this.prisma.biometricEnrollment.findMany({
      where: { organizationId, deviceId },
      include: {
        employee: { select: { id: true, name: true, photoUrl: true } },
        member: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async upsertEnrollment(organizationId: string, deviceId: string, dto: UpsertEnrollmentDto) {
    await this.findOne(organizationId, deviceId);

    if (dto.personType === PunchPersonType.EMPLOYEE) {
      const employee = await this.prisma.employee.findFirst({ where: { id: dto.employeeId, organizationId } });
      if (!employee) throw new NotFoundException('Employee not found.');
    } else {
      const member = await this.prisma.member.findFirst({ where: { id: dto.memberId, organizationId } });
      if (!member) throw new NotFoundException('Member not found.');
    }

    return this.prisma.biometricEnrollment.upsert({
      where: { deviceId_biometricUserId: { deviceId, biometricUserId: dto.biometricUserId } },
      create: {
        organizationId,
        deviceId,
        biometricUserId: dto.biometricUserId,
        personType: dto.personType,
        employeeId: dto.personType === PunchPersonType.EMPLOYEE ? dto.employeeId : null,
        memberId: dto.personType === PunchPersonType.MEMBER ? dto.memberId : null,
      },
      update: {
        personType: dto.personType,
        employeeId: dto.personType === PunchPersonType.EMPLOYEE ? dto.employeeId : null,
        memberId: dto.personType === PunchPersonType.MEMBER ? dto.memberId : null,
      },
    });
  }

  async removeEnrollment(organizationId: string, deviceId: string, enrollmentId: string) {
    const enrollment = await this.prisma.biometricEnrollment.findFirst({ where: { id: enrollmentId, organizationId, deviceId } });
    if (!enrollment) {
      throw new NotFoundException('Enrollment not found.');
    }
    await this.prisma.biometricEnrollment.delete({ where: { id: enrollmentId } });
    return { success: true };
  }

  /** Punches that arrived with a biometricUserId nobody has enrolled
   * yet — surfaced so the Owner knows a device is sending data for a
   * person they haven't mapped, rather than that data silently
   * vanishing. */
  listUnmatchedPunches(organizationId: string) {
    return this.prisma.attendancePunch.findMany({
      where: { organizationId, employeeId: null, memberId: null },
      include: { device: { select: { id: true, name: true } }, branch: { select: { id: true, location: true } } },
      orderBy: { punchTime: 'desc' },
      take: 100,
    });
  }
}
