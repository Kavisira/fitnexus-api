import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { NotificationSeverity, NotificationType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateNotificationSetupDto } from './dto/update-notification-setup.dto';
import { UpdateNotificationConfigDto } from './dto/update-notification-config.dto';
import { NotificationsGateway } from './notifications.gateway';

// Sensible starting defaults for each type — everything that works
// today (leads) is on; the not-yet-wired types (birthday/expiry) are
// off so they don't silently "activate" the moment Employees/Members
// ship, until someone deliberately turns them on.
const DEFAULT_CONFIG: Record<NotificationType, { enabled: boolean; severity: NotificationSeverity }> = {
  LEAD_OVERDUE: { enabled: true, severity: 'URGENT' },
  LEAD_ASSIGNED: { enabled: true, severity: 'INFO' },
  BIRTHDAY_EMPLOYEE: { enabled: false, severity: 'INFO' },
  BIRTHDAY_MEMBER: { enabled: false, severity: 'INFO' },
  MEMBERSHIP_EXPIRY: { enabled: false, severity: 'WARNING' },
};

export interface NotifyInput {
  type: NotificationType;
  title: string;
  message: string;
  entityType?: string;
  entityId?: string;
  groupKey?: string;
  // Overrides the configured severity for this one notification, if
  // the caller has a better sense of urgency than the static default.
  severity?: NotificationSeverity;
}

@Injectable()
export class NotificationsService {
  constructor(
    private prisma: PrismaService,
    private gateway: NotificationsGateway,
  ) {}

  // ---- Setup (org-wide master switch) ----

  /** Always returns a row — creates the default one on first access
   * rather than requiring a separate provisioning step. */
  async getSetup(organizationId: string) {
    const existing = await this.prisma.notificationSetup.findUnique({ where: { organizationId } });
    if (existing) {
      return existing;
    }
    return this.prisma.notificationSetup.create({ data: { organizationId } });
  }

  async updateSetup(organizationId: string, dto: UpdateNotificationSetupDto) {
    await this.getSetup(organizationId); // ensures the row exists
    return this.prisma.notificationSetup.update({ where: { organizationId }, data: dto });
  }

  // ---- Config (per-type rules) ----

  /** Returns one row per NotificationType, creating any missing ones
   * with sane defaults — so the Configuration screen always has a
   * complete, stable list to render even for types added after an
   * organization was created. */
  async listConfigs(organizationId: string) {
    const existing = await this.prisma.notificationConfig.findMany({ where: { organizationId } });
    const existingTypes = new Set(existing.map((c) => c.type));
    const missing = (Object.keys(DEFAULT_CONFIG) as NotificationType[]).filter((t) => !existingTypes.has(t));

    if (missing.length) {
      await this.prisma.notificationConfig.createMany({
        data: missing.map((type) => ({ organizationId, type, ...DEFAULT_CONFIG[type] })),
        skipDuplicates: true,
      });
      return this.prisma.notificationConfig.findMany({ where: { organizationId }, orderBy: { type: 'asc' } });
    }

    return existing.sort((a, b) => a.type.localeCompare(b.type));
  }

  async updateConfig(organizationId: string, type: NotificationType, dto: UpdateNotificationConfigDto) {
    // Prisma's JSON columns need Prisma.JsonNull/DbNull to actually
    // clear the value — a plain `null` on a JSON field isn't
    // assignable to the generated input types, only `undefined`
    // (leave untouched) or a real JSON value is. `rule` is optional
    // here, so translate our DTO's "clear it" null into that.
    const { rule, ...rest } = dto;
    const ruleValue: Prisma.InputJsonValue | typeof Prisma.JsonNull | undefined =
      rule === null ? Prisma.JsonNull : rule === undefined ? undefined : (rule as Prisma.InputJsonValue);

    return this.prisma.notificationConfig.upsert({
      where: { organizationId_type: { organizationId, type } },
      create: {
        organizationId,
        type,
        ...DEFAULT_CONFIG[type],
        ...rest,
        ...(rule !== undefined ? { rule: ruleValue } : {}),
      },
      update: {
        ...rest,
        ...(rule !== undefined ? { rule: ruleValue } : {}),
      },
    });
  }

  // ---- Notifications (list / read / delete) ----

  /** Active notifications (not manually closed) for the bell dropdown
   * and the "view all" screen — most recent first. Grouping is done
   * client-side by groupKey/type so the API stays a simple flat list. */
  list(organizationId: string, limit?: number) {
    return this.prisma.notification.findMany({
      where: { organizationId, closedAt: null },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  /** Counts distinct *groups* with at least one unread notification —
   * a notification without a groupKey counts as its own group of one.
   * This is what the bell badge shows, not a raw notification count. */
  async unreadGroupCount(organizationId: string): Promise<number> {
    const unread = await this.prisma.notification.findMany({
      where: { organizationId, closedAt: null, read: false },
      select: { id: true, groupKey: true },
    });
    const groups = new Set(unread.map((n) => n.groupKey ?? n.id));
    return groups.size;
  }

  async markRead(organizationId: string, id: string) {
    const notification = await this.prisma.notification.findFirst({ where: { id, organizationId } });
    if (!notification) {
      throw new NotFoundException('Notification not found.');
    }
    return this.prisma.notification.update({ where: { id }, data: { read: true } });
  }

  async markAllRead(organizationId: string) {
    await this.prisma.notification.updateMany({
      where: { organizationId, closedAt: null, read: false },
      data: { read: true },
    });
    return { success: true };
  }

  /** Manual delete — only once a notification has been read, so it
   * can't be dismissed without ever having been seen. Auto-clean (see
   * NotificationSetup.autoCleanDays) is the separate, read-independent
   * backstop for anything left lying around. */
  async remove(organizationId: string, id: string) {
    const notification = await this.prisma.notification.findFirst({ where: { id, organizationId } });
    if (!notification) {
      throw new NotFoundException('Notification not found.');
    }
    if (!notification.read) {
      throw new BadRequestException('Read a notification before deleting it.');
    }
    await this.prisma.notification.delete({ where: { id } });
    return { success: true };
  }

  async close(organizationId: string, id: string) {
    const notification = await this.prisma.notification.findFirst({ where: { id, organizationId } });
    if (!notification) {
      throw new NotFoundException('Notification not found.');
    }
    return this.prisma.notification.update({ where: { id }, data: { closedAt: new Date() } });
  }

  // ---- Trigger entry point (used by other modules/cron, not the
  // controller) ----

  /** The single place every notification gets created — checks the
   * org-wide switch and the per-type config before writing anything,
   * so callers (LeadsService, future cron jobs, etc.) never have to
   * duplicate that gating logic. Returns null (creates nothing) when
   * notifications are off overall or for this specific type. */
  async notify(organizationId: string, input: NotifyInput) {
    const setup = await this.getSetup(organizationId);
    if (!setup.enabled) {
      return null;
    }

    const configs = await this.listConfigs(organizationId);
    const config = configs.find((c) => c.type === input.type);
    if (!config || !config.enabled || !config.inAppEnabled) {
      return null;
    }

    const notification = await this.prisma.notification.create({
      data: {
        organizationId,
        type: input.type,
        severity: input.severity ?? config.severity,
        title: input.title,
        message: input.message,
        entityType: input.entityType,
        entityId: input.entityId,
        groupKey: input.groupKey,
      },
    });

    // Push it live to every connected client in the organization —
    // the REST list is still the source of truth on page load/refresh.
    this.gateway.emitToOrganization(organizationId, notification);

    return notification;
  }
}
