import {
  authenticated, boolean, date, entity, int, set, text, uuid,
} from '@microsoft/rayfin-core';
import {
  dataSources, itemTypes, runStatuses, scheduleTypes, PILOT_OWNER_SUBJECT,
  type ScheduledItemRecord,
} from '@rayfin-app/shared';

@entity()
@authenticated('*', { policy: (claims) => claims.sub.eq(PILOT_OWNER_SUBJECT) })
export class ScheduledItem implements ScheduledItemRecord {
  @uuid() id!: string;
  @text({ max: 200, unique: true }) itemKey!: string;
  @text({ max: 64 }) workspaceId!: string;
  @text({ max: 200 }) workspaceName!: string;
  @text({ max: 64, optional: true }) capacityId?: string;
  @text({ max: 4000, optional: true }) liveSchedulesJson?: string;
  @text({ max: 64 }) fabricItemId!: string;
  @text({ max: 300 }) itemName!: string;
  @set(...itemTypes) itemType!: ScheduledItemRecord['itemType'];
  @text({ max: 64, optional: true }) jobType?: string;
  @text({ max: 254, optional: true }) owner?: string;
  @set(...scheduleTypes) scheduleType!: ScheduledItemRecord['scheduleType'];
  @text({ max: 100, optional: true }) scheduleDays?: string;
  @text({ max: 700, optional: true }) scheduleTimes?: string;
  @int({ optional: true }) intervalMinutes?: number;
  @text({ max: 64 }) timeZoneId!: string;
  @boolean() enabled!: boolean;
  @int({ optional: true }) avgDurationSec?: number;
  @int({ optional: true }) medianDurationSec?: number;
  @int({ optional: true }) p90DurationSec?: number;
  @int({ default: 0 }) runs7d!: number;
  @int({ default: 0 }) failures7d!: number;
  @set({ optional: true }, ...runStatuses) lastStatus?: NonNullable<ScheduledItemRecord['lastStatus']>;
  @date({ optional: true }) lastStartUtc?: Date;
  @date({ optional: true }) lastEndUtc?: Date;
  @set(...dataSources) source!: ScheduledItemRecord['source'];
  @date() syncedAt!: Date;
}
