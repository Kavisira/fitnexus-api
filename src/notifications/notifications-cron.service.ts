import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from './notifications.service';

type OffsetUnit = 'MINUTES' | 'HOURS' | 'DAYS';
type Offset = { value: number; unit: OffsetUnit };

// Falls back to this if an org's LEAD_OVERDUE config has no `rule` set
// yet — matches the 1hr / 30min / 15min / on-time reminders discussed
// for lead follow-ups.
const DEFAULT_FOLLOWUP_OFFSETS: Offset[] = [
  { value: 60, unit: 'MINUTES' },
  { value: 30, unit: 'MINUTES' },
  { value: 15, unit: 'MINUTES' },
  { value: 0, unit: 'MINUTES' },
];

function offsetMs(offset: Offset): number {
  switch (offset.unit) {
    case 'MINUTES':
      return offset.value * 60_000;
    case 'HOURS':
      return offset.value * 3_600_000;
    case 'DAYS':
      return offset.value * 86_400_000;
  }
}

@Injectable()
export class NotificationsCronService {
  private readonly logger = new Logger(NotificationsCronService.name);

  constructor(
    private prisma: PrismaService,
    private notificationsService: NotificationsService,
  ) {}

  /**
   * Every 5 minutes — fine-grained enough for minute-level offsets
   * (60/30/15/on-time before a lead's follow-up) without hammering the
   * database. Fires each configured offset for a lead at most once,
   * deduped via a content-derived groupKey, and simply "catches up" if
   * a run is ever missed (fires as soon as it next sees a target time
   * that's already passed) rather than requiring a tight time window.
   *
   * Day-granularity types (membership expiry, once Members exists)
   * will reuse this same offset-matching approach in their own method
   * once there's real expiry data to check.
   */
  @Cron('*/5 * * * *')
  async checkLeadFollowUpReminders(): Promise<void> {
    const now = new Date();
    // Bounded window just to keep the query cheap — wide enough to
    // cover the longest offset anyone would reasonably configure for a
    // same-day reminder.
    const windowStart = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const windowEnd = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);

    const leads = await this.prisma.lead.findMany({
      where: {
        nextFollowUpAt: { not: null, gte: windowStart, lte: windowEnd },
        status: { notIn: ['CONVERTED', 'LOST'] },
      },
      select: { id: true, organizationId: true, name: true, nextFollowUpAt: true },
    });
    if (!leads.length) {
      return;
    }

    const byOrg = new Map<string, typeof leads>();
    for (const lead of leads) {
      const list = byOrg.get(lead.organizationId) ?? [];
      list.push(lead);
      byOrg.set(lead.organizationId, list);
    }

    for (const [organizationId, orgLeads] of byOrg) {
      let offsets: Offset[];
      try {
        const configs = await this.notificationsService.listConfigs(organizationId);
        const config = configs.find((c) => c.type === 'LEAD_OVERDUE');
        if (!config || !config.enabled) {
          continue;
        }
        offsets = (config.rule as { offsets?: Offset[] } | null)?.offsets ?? DEFAULT_FOLLOWUP_OFFSETS;
      } catch (err) {
        this.logger.error(`Failed to load notification config for org ${organizationId}`, err as Error);
        continue;
      }

      for (const lead of orgLeads) {
        const due = lead.nextFollowUpAt!.getTime();
        for (const offset of offsets) {
          const targetTime = due - offsetMs(offset);
          if (now.getTime() < targetTime) {
            continue; // this offset isn't due yet
          }

          const groupKey = `lead-followup:${lead.id}:${due}:${offset.value}${offset.unit}`;
          const alreadyFired = await this.prisma.notification.findFirst({ where: { organizationId, groupKey } });
          if (alreadyFired) {
            continue;
          }

          const label = offset.value === 0 ? 'now' : `in ${offset.value} ${offset.unit.toLowerCase()}`;
          await this.notificationsService.notify(organizationId, {
            type: 'LEAD_OVERDUE',
            title: 'Lead follow-up due',
            message: `${lead.name}'s follow-up is due ${label}.`,
            entityType: 'lead',
            entityId: lead.id,
            groupKey,
          });
        }
      }
    }
  }

  /**
   * Once a day — sweeps every organization that has auto-clean turned
   * on (NotificationSetup.autoCleanDays) and permanently deletes
   * anything older than its configured window, regardless of read or
   * closed state. Manual delete (read-gated) is the other path to the
   * same end; this is just the automatic backstop.
   */
  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async autoCleanNotifications(): Promise<void> {
    const setups = await this.prisma.notificationSetup.findMany({ where: { autoCleanDays: { not: null } } });
    for (const setup of setups) {
      const cutoff = new Date(Date.now() - setup.autoCleanDays! * 24 * 60 * 60 * 1000);
      await this.prisma.notification.deleteMany({
        where: { organizationId: setup.organizationId, createdAt: { lt: cutoff } },
      });
    }
  }
}
