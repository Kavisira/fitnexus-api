import { Injectable, Logger } from '@nestjs/common';
import { PunchDirection } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface RawPunch {
  biometricUserId: string;
  punchTime: Date;
  direction: PunchDirection;
  raw?: string;
}

/**
 * Shared punch-recording logic for every ingestion path (ADMS push,
 * generic webhook, CSV import) — each path is responsible only for
 * getting a device's raw events into this common RawPunch shape; this
 * service does the one thing that's the same regardless of source:
 * resolve the enrollment and write the AttendancePunch row.
 *
 * An unresolved biometricUserId (no BiometricEnrollment on file) still
 * gets recorded — with employeeId/memberId left null — rather than
 * dropped, so it shows up in "unmatched punches" for the Owner to
 * enroll instead of silently vanishing.
 */
@Injectable()
export class AttendanceIngestService {
  private readonly logger = new Logger(AttendanceIngestService.name);

  constructor(private prisma: PrismaService) {}

  async recordPunches(organizationId: string, branchId: string, deviceId: string, punches: RawPunch[]): Promise<{ recorded: number }> {
    if (!punches.length) {
      return { recorded: 0 };
    }

    const biometricUserIds = [...new Set(punches.map((p) => p.biometricUserId))];
    const enrollments = await this.prisma.biometricEnrollment.findMany({
      where: { deviceId, biometricUserId: { in: biometricUserIds } },
    });
    const byUserId = new Map(enrollments.map((e) => [e.biometricUserId, e]));

    await this.prisma.attendancePunch.createMany({
      data: punches.map((p) => {
        const enrollment = byUserId.get(p.biometricUserId);
        return {
          organizationId,
          branchId,
          deviceId,
          biometricUserId: p.biometricUserId,
          personType: enrollment?.personType ?? 'EMPLOYEE',
          employeeId: enrollment?.employeeId ?? null,
          memberId: enrollment?.memberId ?? null,
          punchTime: p.punchTime,
          direction: p.direction,
          raw: p.raw,
        };
      }),
    });

    await this.prisma.biometricDevice.update({ where: { id: deviceId }, data: { lastSeenAt: new Date() } });

    this.logger.log(`Recorded ${punches.length} punch(es) from device ${deviceId}.`);
    return { recorded: punches.length };
  }
}
