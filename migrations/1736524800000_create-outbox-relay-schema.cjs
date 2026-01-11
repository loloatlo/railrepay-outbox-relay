/**
 * Migration: Create outbox_relay schema and relay_state table
 */

exports.up = (pgm) => {
  // Step 1: Create outbox_relay schema
  pgm.createSchema('outbox_relay', { ifNotExists: true });

  // Step 2: Create relay_state table
  pgm.createTable(
    { schema: 'outbox_relay', name: 'relay_state' },
    {
      id: {
        type: 'uuid',
        primaryKey: true,
        default: pgm.func('gen_random_uuid()'),
      },
      schema_name: {
        type: 'varchar(100)',
        notNull: true,
        unique: true,
      },
      table_name: {
        type: 'varchar(100)',
        notNull: true,
      },
      last_poll_time: {
        type: 'timestamptz',
        notNull: true,
        default: pgm.func('now()'),
      },
      last_published_event_id: {
        type: 'uuid',
        notNull: false,
      },
      total_events_published: {
        type: 'bigint',
        notNull: true,
        default: 0,
      },
      created_at: {
        type: 'timestamptz',
        notNull: true,
        default: pgm.func('now()'),
      },
      updated_at: {
        type: 'timestamptz',
        notNull: true,
        default: pgm.func('now()'),
      },
    }
  );

  // Create indexes
  pgm.createIndex(
    { schema: 'outbox_relay', name: 'relay_state' },
    'last_poll_time',
    { name: 'idx_relay_state_last_poll' }
  );

  pgm.createIndex(
    { schema: 'outbox_relay', name: 'relay_state' },
    'schema_name',
    { name: 'idx_relay_state_schema' }
  );
};

exports.down = (pgm) => {
  pgm.dropTable({ schema: 'outbox_relay', name: 'relay_state' }, {
    ifExists: true,
    cascade: true,
  });
  pgm.dropSchema('outbox_relay', { ifExists: true, cascade: true });
};
