import { authenticated, date, entity, text, uuid } from '@microsoft/rayfin-core';
import { PILOT_OWNER_SUBJECT, type SavedViewRecord } from '@rayfin-app/shared';

@entity()
@authenticated('*', {
  policy: (claims, item) => claims.sub.eq(item.user_id).and(claims.sub.eq(PILOT_OWNER_SUBJECT)),
})
export class SavedView implements SavedViewRecord {
  @uuid() id!: string;
  @text({ max: 128 }) user_id!: string;
  @text({ max: 100 }) name!: string;
  @text({ max: 2000 }) filtersJson!: string;
  @date() createdAt!: Date;
}
