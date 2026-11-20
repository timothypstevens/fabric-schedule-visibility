export const itemTypes = [
  'SemanticModel', 'DataflowGen2', 'DataflowGen1', 'DataPipeline',
  'Notebook', 'SparkJobDefinition', 'CopyJob', 'Other',
] as const;
export type ItemType = (typeof itemTypes)[number];

export const runStatuses = [
  'Completed', 'Failed', 'InProgress', 'Cancelled', 'NotStarted', 'Deduped', 'Unknown',
] as const;
export type RunStatus = (typeof runStatuses)[number];

export const dataSources = ['sample', 'live'] as const;
export type DataSource = (typeof dataSources)[number];

export const scheduleTypes = ['Daily', 'Weekly', 'Interval', 'Monthly'] as const;
export type ScheduleType = (typeof scheduleTypes)[number];

export const invokeTypes = ['Scheduled', 'Manual', 'ViaApi', 'Other'] as const;
export type InvokeType = (typeof invokeTypes)[number];

export const criticalities = ['Executive', 'Standard', 'Flexible'] as const;
export type Criticality = (typeof criticalities)[number];

export const syncStatuses = ['Running', 'Succeeded', 'Partial', 'Failed'] as const;
export type SyncStatus = (typeof syncStatuses)[number];

export interface ScheduledItemRecord {
  id: string;
  itemKey: string;
  workspaceId: string;
  workspaceName: string;
  capacityId?: string;
  liveSchedulesJson?: string;
  fabricItemId: string;
  itemName: string;
  itemType: ItemType;
  jobType?: string;
  owner?: string;
  scheduleType: ScheduleType;
  scheduleDays?: string;
  scheduleTimes?: string;
  intervalMinutes?: number;
  timeZoneId: string;
  enabled: boolean;
  avgDurationSec?: number | null;
  medianDurationSec?: number | null;
  p90DurationSec?: number | null;
  runs7d: number;
  failures7d: number;
  lastStatus?: RunStatus | null;
  lastStartUtc?: Date | null;
  lastEndUtc?: Date | null;
  source: DataSource;
  syncedAt: Date;
}

export interface RunInstanceRecord {
  id: string;
  itemKey: string;
  runId: string;
  status: RunStatus;
  invokeType?: InvokeType;
  startUtc: Date;
  endUtc?: Date;
  failureReason?: string;
  source: DataSource;
}

export interface ItemAnnotationRecord {
  id: string;
  itemKey: string;
  criticality: Criticality;
  businessOwner?: string;
  note?: string;
  updatedBy: string;
  updatedAt: Date;
}

export interface SavedViewRecord {
  id: string;
  user_id: string;
  name: string;
  filtersJson: string;
  createdAt: Date;
}

export interface SyncRunRecord {
  id: string;
  source: DataSource;
  status: SyncStatus;
  startedAt: Date;
  finishedAt?: Date;
  itemsSynced: number;
  runsSynced: number;
  message?: string;
}

export type AppSchema = {
  ScheduledItem: ScheduledItemRecord;
  RunInstance: RunInstanceRecord;
  ItemAnnotation: ItemAnnotationRecord;
  SavedView: SavedViewRecord;
  SyncRun: SyncRunRecord;
};

export type UniversalAppSchema = AppSchema;
export { PILOT_OWNER_SUBJECT } from './access.js';
export { parseLiveSchedules } from './live-schedules.js';

export interface LiveSchedule {
  enabled: boolean;
  type: 'Daily' | 'Weekly' | 'Interval';
  timeZoneId: string;
  startUtc: string;
  endUtc: string;
  times?: string;
  days?: string;
  intervalMinutes?: number;
}

