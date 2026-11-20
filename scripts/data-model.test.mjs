import assert from 'node:assert/strict';
import { test } from 'node:test';
import { schema } from '@rayfin-app/data';
import { ConfigGenerator, SchemaAnalyzer } from '@microsoft/rayfin-core/analysis';
import { PILOT_OWNER_SUBJECT } from '@rayfin-app/shared';

const analysis = new SchemaAnalyzer(schema, 'mssql', { log: () => {} }).analyzeEntities();
const { entities } = new ConfigGenerator('mssql').generateConfig(analysis);

test('only the five application entities are exposed with authenticated permissions', () => {
  assert.deepEqual(Object.keys(entities).sort(), [
    'ItemAnnotation', 'RunInstance', 'SavedView', 'ScheduledItem', 'SyncRun',
  ]);
  for (const [name, entity] of Object.entries(entities)) {
    assert.deepEqual(entity.permissions.map(({ role }) => role), ['authenticated']);
    if (name !== 'SavedView') {
      assert.deepEqual(entity.permissions[0].actions, [{
        action: '*', policy: { database: `@claims.sub eq '${PILOT_OWNER_SUBJECT}'` },
      }]);
    }
  }
});

test('SavedView compiles subject ownership into the database policy for all actions', () => {
  assert.deepEqual(entities.SavedView.permissions[0].actions, [{
    action: '*',
    policy: { database: `(@claims.sub eq @item.user_id) and (@claims.sub eq '${PILOT_OWNER_SUBJECT}')` },
  }]);
  assert.equal(entities.SavedView['x-schema'].fields.user_id.dbType, 'NVARCHAR(128)');
});

test('MSSQL schema preserves nullable history, schedule capacity, defaults and unique keys', () => {
  for (const entity of Object.values(entities)) {
    for (const field of Object.values(entity['x-schema'].fields)) {
      assert.notEqual(field.dbType, 'NVARCHAR(MAX)');
    }
  }

  const scheduled = entities.ScheduledItem['x-schema'];
  assert.equal(scheduled.fields.scheduleTimes.dbType, 'NVARCHAR(700)');
  for (const field of [
    'jobType', 'owner', 'scheduleDays', 'scheduleTimes', 'intervalMinutes',
    'avgDurationSec', 'medianDurationSec', 'p90DurationSec', 'lastStatus',
    'lastStartUtc', 'lastEndUtc',
  ]) {
    assert.equal(scheduled.fields[field].nullable, true, field);
  }
  assert.equal(scheduled.fields.runs7d.defaultValue, 0);
  assert.equal(scheduled.fields.failures7d.defaultValue, 0);
  assert.deepEqual(scheduled.constraints.uniqueConstraints.map(({ columns }) => columns), [['itemKey']]);
  assert.deepEqual(
    entities.ItemAnnotation['x-schema'].constraints.uniqueConstraints.map(({ columns }) => columns),
    [['itemKey']],
  );
  assert.equal(entities.RunInstance['x-schema'].fields.status.nullable, false);
  assert.equal(entities.RunInstance['x-schema'].fields.endUtc.nullable, true);
  assert.equal(entities.SyncRun['x-schema'].fields.finishedAt.nullable, true);
});
