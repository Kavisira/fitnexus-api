import { Body, Controller, Get, Headers, Logger, Post, Query, Req, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { PunchDirection } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AttendanceIngestService, RawPunch } from './attendance-ingest.service';
import { GenericPunchBatchDto } from './dto/generic-punch.dto';

/**
 * Two ingestion paths, deliberately kept apart because their auth and
 * wire format are unrelated:
 *
 *  - /iclock/* — the ADMS protocol ZKTeco, eSSL, and other same-firmware
 *    OEMs speak natively. No bearer token exists in this protocol; a device
 *    identifies itself only by its serial number (?SN=...) matched
 *    against a BiometricDevice row the Owner registered beforehand.
 *    This is what these devices actually send — not something we
 *    designed, so the format here follows the real protocol rather
 *    than our own conventions. Firmware behavior (esp. the STATUS code
 *    meaning per punch) varies by vendor/model; the mapping below is
 *    the common convention but may need tuning against real hardware.
 *
 *  - /attendance/ingest/webhook/:deviceId — for anything else (a local
 *    bridge program, a device with its own HTTP push, manual scripting)
 *    — plain JSON, authenticated with the device's own apiKey as a
 *    Bearer token.
 *
 * Neither path uses JwtAuthGuard/PermissionGuard — the caller is a
 * device, not a logged-in user.
 */
@Controller()
export class AttendanceIngestController {
  private readonly logger = new Logger(AttendanceIngestController.name);

  constructor(
    private prisma: PrismaService,
    private ingestService: AttendanceIngestService,
  ) {}

  // ---- ADMS / iclock ----

  /** Handshake + the device's periodic "any commands for me?" poll.
   * We never queue remote commands, so the answer is always "nothing
   * to do" — just enough for the device to consider the connection
   * healthy and keep pushing attendance logs on its own schedule. */
  @Get('iclock/cdata')
  async handshake(@Query('SN') serialNumber: string): Promise<string> {
    await this.touchDevice(serialNumber);
    return 'OK';
  }

  @Get('iclock/getrequest')
  async getRequest(@Query('SN') serialNumber: string): Promise<string> {
    await this.touchDevice(serialNumber);
    return 'OK';
  }

  /** The actual attendance push. table=ATTLOG is the only one we act
   * on; other tables (OPERLOG, ATTPHOTO, ...) are acknowledged but
   * ignored — we don't need them for attendance tracking. */
  @Post('iclock/cdata')
  async receiveData(@Query('SN') serialNumber: string, @Query('table') table: string | undefined, @Req() req: Request): Promise<string> {
    const device = await this.prisma.biometricDevice.findFirst({ where: { serialNumber, vendorType: 'ADMS_PUSH' } });
    if (!device) {
      // Respond OK regardless — an unregistered device retrying forever
      // is worse than one silent drop, and there's no user on the other
      // end to show an error to. Logged so the Owner can notice and
      // register it from the Devices screen.
      this.logger.warn(`ADMS push from unregistered serial number "${serialNumber}".`);
      return 'OK';
    }

    if (table && table !== 'ATTLOG') {
      return 'OK';
    }

    const body = typeof req.body === 'string' ? req.body : '';
    const punches = this.parseAttlog(body);
    await this.ingestService.recordPunches(device.organizationId, device.branchId, device.id, punches);
    return 'OK';
  }

  private async touchDevice(serialNumber: string | undefined): Promise<void> {
    if (!serialNumber) return;
    await this.prisma.biometricDevice.updateMany({
      where: { serialNumber, vendorType: 'ADMS_PUSH' },
      data: { lastSeenAt: new Date() },
    });
  }

  /** ATTLOG lines are tab-separated: PIN, TIME, STATUS, VERIFY,
   * WORKCODE, then reserved fields we don't use. STATUS 0/3/4 read as
   * an "in" punch and 1/2/5 as "out" on the devices this was modeled
   * on; anything else is recorded as UNKNOWN rather than guessed at. */
  private parseAttlog(body: string): RawPunch[] {
    const lines = body.split('\n').map((l) => l.trim()).filter(Boolean);
    const punches: RawPunch[] = [];
    for (const line of lines) {
      const fields = line.split('\t');
      const [pin, time, status] = fields;
      if (!pin || !time) continue;
      const punchTime = new Date(time.replace(' ', 'T'));
      if (Number.isNaN(punchTime.getTime())) continue;

      let direction: PunchDirection = 'UNKNOWN';
      if (status === '0' || status === '3' || status === '4') direction = 'IN';
      else if (status === '1' || status === '2' || status === '5') direction = 'OUT';

      punches.push({ biometricUserId: pin, punchTime, direction, raw: line });
    }
    return punches;
  }

  // ---- Generic webhook ----

  @Post('attendance/ingest/webhook/:deviceId')
  async receiveWebhook(
    @Req() req: Request & { params: { deviceId: string } },
    @Headers('authorization') authorization: string | undefined,
    @Body() dto: GenericPunchBatchDto,
  ) {
    const deviceId = req.params.deviceId;
    const device = await this.prisma.biometricDevice.findFirst({ where: { id: deviceId, vendorType: 'GENERIC_WEBHOOK' } });
    if (!device) {
      throw new UnauthorizedException('Unknown device.');
    }
    const token = authorization?.replace(/^Bearer\s+/i, '');
    if (token !== device.apiKey) {
      throw new UnauthorizedException('Invalid device API key.');
    }

    const punches: RawPunch[] = dto.events.map((e) => ({
      biometricUserId: e.biometricUserId,
      punchTime: new Date(e.timestamp),
      direction: e.direction ?? 'UNKNOWN',
    }));
    return this.ingestService.recordPunches(device.organizationId, device.branchId, device.id, punches);
  }
}
