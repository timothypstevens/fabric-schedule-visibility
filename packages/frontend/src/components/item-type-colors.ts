import type { ItemType } from '@rayfin-app/shared';

export const itemTypeColorTokens: Record<ItemType, string> = {
  SemanticModel: '--color-type-semantic-model',
  DataflowGen2: '--color-type-dataflow-gen2',
  DataflowGen1: '--color-type-dataflow-gen1',
  DataPipeline: '--color-type-data-pipeline',
  Notebook: '--color-type-notebook',
  SparkJobDefinition: '--color-type-spark-job-definition',
  CopyJob: '--color-type-copy-job',
  Other: '--color-type-other',
};
