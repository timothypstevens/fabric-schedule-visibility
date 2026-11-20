import { authenticated, date, entity, int, set, text, uuid } from '@microsoft/rayfin-core';
import { dataSources, syncStatuses, PILOT_OWNER_SUBJECT, type SyncRunRecord } from '@rayfin-app/shared';

@entity()
@authenticated('*', { policy: (claims) => claims.sub.eq(PILOT_OWNER_SUBJECT) })
export class SyncRun implements SyncRunRecord {
  @uuid() id!: string;
  @set(...dataSources) source!: SyncRunRecord['source'];
  @set(...syncStatuses) status!: SyncRunRecord['status'];
  @date() startedAt!: Date;
  @date({ optional: true }) finishedAt?: Date;
  @int() itemsSynced!: number;
  @int() runsSynced!: number;
  @text({ max: 1000, optional: true }) message?: string;
}
