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

// Default reminder schedule before a membership expires — "7 days
// before", "3 days before", "on the day" is the common renewal-nudge
// cadence; orgs can override via MEMBERSHIP_EXPIRY's config.rule.offsets
// (same {offsets:[{value,unit}]} shape as LEAD_OVERDUE, just DAYS-only
// in practice since this cron only runs once a day).
const DEFAULT_MEMBERSHIP_EXPIRY_OFFSETS: Offset[] = [
  { value: 7, unit: 'DAYS' },
  { value: 3, unit: 'DAYS' },
  { value: 0, unit: 'DAYS' },
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
      select: {
        id: true,
        organizationId: true,
        name: true,
        nextFollowUpAt: true,
        assignedToEmployee: { select: { phone: true, email: true, name: true } },
      },
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

      // Collect every (lead, offset) pair that's actually due right now
      // first, then check which have already fired with ONE batched
      // query instead of a separate findFirst per pair — this used to
      // be an N+1 (one round-trip per lead per offset, every 5 minutes,
      // scaling with lead volume). Same dedup/notify logic as before,
      // just batched.
      const dueCandidates: { lead: (typeof orgLeads)[number]; offset: Offset; groupKey: string }[] = [];
      for (const lead of orgLeads) {
        const due = lead.nextFollowUpAt!.getTime();
        for (const offset of offsets) {
          const targetTime = due - offsetMs(offset);
          if (now.getTime() < targetTime) {
            continue; // this offset isn't due yet
          }
          dueCandidates.push({ lead, offset, groupKey: `lead-followup:${lead.id}:${due}:${offset.value}${offset.unit}` });
        }
      }
      if (!dueCandidates.length) {
        continue;
      }

      const alreadyFired = await this.prisma.notification.findMany({
        where: { organizationId, groupKey: { in: dueCandidates.map((c) => c.groupKey) } },
        select: { groupKey: true },
      });
      const firedKeys = new Set(alreadyFired.map((n) => n.groupKey));

      for (const { lead, offset, groupKey } of dueCandidates) {
        if (firedKeys.has(groupKey)) {
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
          recipient: lead.assignedToEmployee
            ? { phone: lead.assignedToEmployee.phone, email: lead.assignedToEmployee.email, name: lead.assignedToEmployee.name }
            : undefined,
        });
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

  /**
   * Once a day — BIRTHDAY_EMPLOYEE and BIRTHDAY_MEMBER were defined
   * from the start but never actually checked (both Employee and
   * Member have had dateOfBirth all along — see their schema comments
   * — the gap was purely "nothing reads it"). Per-org, per-type gated
   * the same way every other notify() caller is: skipped entirely if
   * that org turned the type off. Recipient is the person themselves
   * (see NotifyInput.recipient) — a birthday wish is personal, not an
   * admin alert, so WhatsApp/Email (when that type's config enables
   * them) go straight to the employee/member, while the in-app
   * notification still shows up for admins same as any other type.
   * Deduped via a per-day groupKey so re-running the cron (or a missed
   * run catching up) never double-wishes someone the same day.
   */
  @Cron(CronExpression.EVERY_DAY_AT_8AM)
  async checkBirthdays(): Promise<void> {
    const today = new Date();
    const month = today.getMonth() + 1;
    const day = today.getDate();
    const dateKey = today.toISOString().slice(0, 10);

    const organizations = await this.prisma.organization.findMany({ select: { id: true } });

    for (const { id: organizationId } of organizations) {
      let configs;
      try {
        configs = await this.notificationsService.listConfigs(organizationId);
      } catch (err) {
        this.logger.error(`Failed to load notification config for org ${organizationId}`, err as Error);
        continue;
      }

      const employeeConfig = configs.find((c) => c.type === 'BIRTHDAY_EMPLOYEE');
      if (employeeConfig?.enabled) {
        // dateOfBirth is stored as a full DateTime, not a month/day
        // pair, so this can't be a single indexed equality query —
        // fetched once per org (small, bounded set) and filtered in
        // Node. Fine at this scale; revisit with a raw EXTRACT query
        // if an org's employee count ever makes this slow.
        const employees = await this.prisma.employee.findMany({
          where: { organizationId, status: 'ACTIVE', dateOfBirth: { not: null } },
          select: { id: true, name: true, phone: true, email: true, dateOfBirth: true },
        });
        for (const employee of employees) {
          const dob = employee.dateOfBirth!;
          if (dob.getMonth() + 1 !== month || dob.getDate() !== day) continue;

          await this.notificationsService.notify(organizationId, {
            type: 'BIRTHDAY_EMPLOYEE',
            title: 'Employee birthday',
            message: `Today is ${employee.name}'s birthday!`,
            entityType: 'employee',
            entityId: employee.id,
            groupKey: `birthday-employee:${employee.id}:${dateKey}`,
            recipient: { phone: employee.phone, email: employee.email, name: employee.name },
          });
        }
      }

      const memberConfig = configs.find((c) => c.type === 'BIRTHDAY_MEMBER');
      if (memberConfig?.enabled) {
        const members = await this.prisma.member.findMany({
          where: { organizationId, status: 'ACTIVE', dateOfBirth: { not: null } },
          select: { id: true, name: true, phone: true, email: true, dateOfBirth: true },
        });
        for (const member of members) {
          const dob = member.dateOfBirth!;
          if (dob.getMonth() + 1 !== month || dob.getDate() !== day) continue;

          await this.notificationsService.notify(organizationId, {
            type: 'BIRTHDAY_MEMBER',
            title: 'Member birthday',
            message: `Today is ${member.name}'s birthday!`,
            entityType: 'member',
            entityId: member.id,
            groupKey: `birthday-member:${member.id}:${dateKey}`,
            recipient: { phone: member.phone, email: member.email, name: member.name },
          });
        }
      }
    }
  }

  /**
   * Once a day — MEMBERSHIP_EXPIRY was the third notification type
   * defined from the start but never checked, same gap as the
   * birthdays above. Reuses the offset-matching idea from
   * checkLeadFollowUpReminders (see DEFAULT_MEMBERSHIP_EXPIRY_OFFSETS)
   * but at day granularity, since a once-daily cron can't usefully
   * promise a minute-precise "N hours before". Recipient is the
   * member directly — this is the one notification type genuinely
   * meant to reach a customer, not just staff, since it's a renewal
   * nudge ("your membership expires in 3 days").
   */
  @Cron(CronExpression.EVERY_DAY_AT_8AM)
  async checkMembershipExpiry(): Promise<void> {
    const today = new Date();
    const todayDateOnly = new Date(today.getFullYear(), today.getMonth(), today.getDate());

    const organizations = await this.prisma.organization.findMany({ select: { id: true } });

    for (const { id: organizationId } of organizations) {
      let config;
      try {
        const configs = await this.notificationsService.listConfigs(organizationId);
        config = configs.find((c) => c.type === 'MEMBERSHIP_EXPIRY');
      } catch (err) {
        this.logger.error(`Failed to load notification config for org ${organizationId}`, err as Error);
        continue;
      }
      if (!config?.enabled) continue;

      const offsets = (config.rule as { offsets?: Offset[] } | null)?.offsets ?? DEFAULT_MEMBERSHIP_EXPIRY_OFFSETS;
      const offsetDays = [...new Set(offsets.map((o) => Math.round(offsetMs(o) / 86_400_000)))];
      if (!offsetDays.length) continue;

      // Members whose endDate falls on exactly one of today+offsetDays
      // — bounded to the widest offset so this stays a cheap range
      // query rather than scanning every active member.
      const maxOffset = Math.max(...offsetDays);
      const rangeEnd = new Date(todayDateOnly.getTime() + (maxOffset + 1) * 86_400_000);

      const members = await this.prisma.member.findMany({
        where: { organizationId, status: 'ACTIVE', endDate: { gte: todayDateOnly, lt: rangeEnd } },
        select: { id: true, name: true, phone: true, email: true, endDate: true },
      });

      for (const member of members) {
        const daysUntilExpiry = Math.round((member.endDate.getTime() - todayDateOnly.getTime()) / 86_400_000);
        if (!offsetDays.includes(daysUntilExpiry)) continue;

        const label =
          daysUntilExpiry === 0 ? 'expires today' : `expires in ${daysUntilExpiry} day${daysUntilExpiry === 1 ? '' : 's'}`;

        await this.notificationsService.notify(organizationId, {
          type: 'MEMBERSHIP_EXPIRY',
          title: 'Membership expiring',
          message: `${member.name}'s membership ${label}.`,
          entityType: 'member',
          entityId: member.id,
          groupKey: `membership-expiry:${member.id}:${daysUntilExpiry}d`,
          recipient: { phone: member.phone, email: member.email, name: member.name },
        });
      }
    }
  }
}
