import { authenticated, date, entity, set, text, uuid } from '@microsoft/rayfin-core';
import { dataSources, invokeTypes, runStatuses, PILOT_OWNER_SUBJECT, type RunInstanceRecord } from '@rayfin-app/shared';

@entity()
@authenticated('*', { policy: (claims) => claims.sub.eq(PILOT_OWNER_SUBJECT) })
export class RunInstance implements RunInstanceRecord {
  @uuid() id!: string;
  @text({ max: 200 }) itemKey!: string;
  @text({ max: 64 }) runId!: string;
  @set(...runStatuses) status!: RunInstanceRecord['status'];
  @set({ optional: true }, ...invokeTypes) invokeType?: RunInstanceRecord['invokeType'];
  @date() startUtc!: Date;
  @date({ optional: true }) endUtc?: Date;
  @text({ max: 1000, optional: true }) failureReason?: string;
  @set(...dataSources) source!: RunInstanceRecord['source'];
}
