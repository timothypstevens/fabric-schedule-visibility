import { ItemAnnotation } from './ItemAnnotation.js';
import { RunInstance } from './RunInstance.js';
import { SavedView } from './SavedView.js';
import { ScheduledItem } from './ScheduledItem.js';
import { SyncRun } from './SyncRun.js';

export { ItemAnnotation, RunInstance, SavedView, ScheduledItem, SyncRun };

export type AppSchema = {
  ScheduledItem: ScheduledItem;
  RunInstance: RunInstance;
  ItemAnnotation: ItemAnnotation;
  SavedView: SavedView;
  SyncRun: SyncRun;
};

export const schema = [ScheduledItem, RunInstance, ItemAnnotation, SavedView, SyncRun];
