/**
 * Migration: Create failed_events table (Dead-Letter Queue)
 */

exports.up = (pgm) => {
  pgm.createTable(
    { schema: 'outbox_relay', name: 'failed_events' },
    {
      id: {
        type: 'uuid',
        primaryKey: true,
        default: pgm.func('gen_random_uuid()'),
      },
      original_event_id: {
        type: 'uuid',
        notNull: true,
      },
      source_schema: {
        type: 'varchar(100)',
        notNull: true,
      },
      source_table: {
        type: 'varchar(100)',
        notNull: true,
      },
      event_type: {
        type: 'varchar(100)',
        notNull: true,
      },
      payload: {
        type: 'jsonb',
        notNull: true,
      },
      failure_reason: {
        type: 'text',
        notNull: true,
      },
      failure_count: {
        type: 'integer',
        notNull: true,
        default: 1,
      },
      first_failed_at: {
        type: 'timestamptz',
        notNull: true,
        default: pgm.func('now()'),
      },
      last_failed_at: {
        type: 'timestamptz',
        notNull: true,
        default: pgm.func('now()'),
      },
      created_at: {
        type: 'timestamptz',
        notNull: true,
        default: pgm.func('now()'),
      },
    }
  );

  // Indexes
  pgm.createIndex(
    { schema: 'outbox_relay', name: 'failed_events' },
    ['source_schema', 'source_table'],
    { name: 'idx_failed_events_source' }
  );

  pgm.createIndex(
    { schema: 'outbox_relay', name: 'failed_events' },
    'event_type',
    { name: 'idx_failed_events_type' }
  );

  pgm.createIndex(
    { schema: 'outbox_relay', name: 'failed_events' },
    'first_failed_at',
    { name: 'idx_failed_events_first_failed' }
  );

  pgm.createIndex(
    { schema: 'outbox_relay', name: 'failed_events' },
    'payload',
    { name: 'idx_failed_events_payload', method: 'gin' }
  );
};

exports.down = (pgm) => {
  pgm.dropTable({ schema: 'outbox_relay', name: 'failed_events' }, {
    ifExists: true,
    cascade: true,
  });
};
