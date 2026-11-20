import { authenticated, date, entity, set, text, uuid } from '@microsoft/rayfin-core';
import { criticalities, PILOT_OWNER_SUBJECT, type ItemAnnotationRecord } from '@rayfin-app/shared';

@entity()
@authenticated('*', { policy: (claims) => claims.sub.eq(PILOT_OWNER_SUBJECT) })
export class ItemAnnotation implements ItemAnnotationRecord {
  @uuid() id!: string;
  @text({ max: 200, unique: true }) itemKey!: string;
  @set(...criticalities) criticality!: ItemAnnotationRecord['criticality'];
  @text({ max: 120, optional: true }) businessOwner?: string;
  @text({ max: 1000, optional: true }) note?: string;
  @text({ max: 254 }) updatedBy!: string;
  @date() updatedAt!: Date;
}
