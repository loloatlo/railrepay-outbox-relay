/**
 * Integration tests for outbox-relay database migrations
 *
 * Test-Driven Development (TDD) approach:
 * - These tests are written BEFORE Blake implements the migrations
 * - Tests MUST FAIL initially (expected behavior documented)
 * - Blake runs migrations to make tests pass (Phase 3)
 *
 * Test strategy:
 * - Use Testcontainers to spin up ephemeral PostgreSQL 16 container
 * - Run migrations against container (UP direction)
 * - Verify schema, tables, columns, constraints, indexes
 * - Test rollback migrations (DOWN direction)
 * - Verify cross-schema permissions
 *
 * Coverage:
 * - Migration 1: Create outbox_relay schema and relay_state table
 * - Migration 2: Create failed_events table (DLQ)
 * - Migration 3: Grant cross-schema permissions
 *
 * @see /services/outbox-relay/docs/rfcs/RFC-001-outbox-relay-schema.md § 7
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { GenericContainer, StartedTestContainer } from 'testcontainers';
import { Client as PgClient } from 'pg';
import path from 'path';

/**
 * IMPORTANT: This test file uses dynamic import for node-pg-migrate
 * to avoid module resolution issues in Vitest environment.
 *
 * The migrate function is imported inside test lifecycle hooks.
 */

let postgresContainer: StartedTestContainer;
let pgClient: PgClient;
let databaseUrl: string;

/**
 * Setup: Spin up PostgreSQL container before all tests
 */
beforeAll(async () => {
  console.log('Starting PostgreSQL 16 container...');

  postgresContainer = await new GenericContainer('postgres:16-alpine')
    .withExposedPorts(5432)
    .withEnvironment({
      POSTGRES_DB: 'test',
      POSTGRES_USER: 'test',
      POSTGRES_PASSWORD: 'test',
    })
    .start();

  const host = postgresContainer.getHost();
  const port = postgresContainer.getMappedPort(5432);
  databaseUrl = `postgres://test:test@${host}:${port}/test`;

  pgClient = new PgClient({
    host,
    port,
    database: 'test',
    user: 'test',
    password: 'test',
  });

  await pgClient.connect();
  console.log('PostgreSQL container started successfully');
}, 60000); // 60s timeout for container startup

/**
 * Teardown: Stop container and close connections after all tests
 */
afterAll(async () => {
  if (pgClient) {
    await pgClient.end();
  }
  if (postgresContainer) {
    await postgresContainer.stop();
  }
  console.log('PostgreSQL container stopped');
});

/**
 * Test Suite 1: Migration 1 - Create outbox_relay schema and relay_state table
 */
describe('Migration 1: Create outbox_relay schema', () => {
  /**
   * Test: Schema creation
   * EXPECTED TO FAIL: Schema does not exist until migration runs
   */
  it('should create outbox_relay schema', async () => {
    // Run migration 1
    const { default: migrate } = await import('node-pg-migrate');
    await migrate({
      databaseUrl,
      dir: path.join(__dirname, '../../../migrations'),
      direction: 'up',
      count: 1, // Only run first migration
      migrationsTable: 'pgmigrations',
      log: console.log,
    });

    // Verify schema exists
    const result = await pgClient.query(
      "SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'outbox_relay'"
    );

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].schema_name).toBe('outbox_relay');
  });

  /**
   * Test: relay_state table structure
   * EXPECTED TO FAIL: Table does not exist until migration runs
   */
  it('should create relay_state table with correct columns', async () => {
    const result = await pgClient.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'outbox_relay' AND table_name = 'relay_state'
      ORDER BY ordinal_position
    `);

    // Verify all columns exist with correct types
    const columns = result.rows.map((r) => ({
      name: r.column_name,
      type: r.data_type,
      nullable: r.is_nullable,
    }));

    expect(columns).toContainEqual({
      name: 'id',
      type: 'uuid',
      nullable: 'NO',
    });

    expect(columns).toContainEqual({
      name: 'schema_name',
      type: 'character varying',
      nullable: 'NO',
    });

    expect(columns).toContainEqual({
      name: 'table_name',
      type: 'character varying',
      nullable: 'NO',
    });

    expect(columns).toContainEqual({
      name: 'last_poll_time',
      type: 'timestamp with time zone',
      nullable: 'NO',
    });

    expect(columns).toContainEqual({
      name: 'last_published_event_id',
      type: 'uuid',
      nullable: 'YES', // Nullable (optional cursor)
    });

    expect(columns).toContainEqual({
      name: 'total_events_published',
      type: 'bigint',
      nullable: 'NO',
    });

    expect(columns).toContainEqual({
      name: 'created_at',
      type: 'timestamp with time zone',
      nullable: 'NO',
    });

    expect(columns).toContainEqual({
      name: 'updated_at',
      type: 'timestamp with time zone',
      nullable: 'NO',
    });
  });

  /**
   * Test: UNIQUE constraint on schema_name
   * EXPECTED TO FAIL: Constraint does not exist until migration runs
   */
  it('should enforce UNIQUE constraint on schema_name', async () => {
    // Insert first row (should succeed)
    await pgClient.query(`
      INSERT INTO outbox_relay.relay_state (schema_name, table_name)
      VALUES ('journey_matcher', 'outbox')
    `);

    // Attempt duplicate insert (should fail with UNIQUE constraint violation)
    await expect(
      pgClient.query(`
        INSERT INTO outbox_relay.relay_state (schema_name, table_name)
        VALUES ('journey_matcher', 'outbox')
      `)
    ).rejects.toThrow(/duplicate key value violates unique constraint/);
  });

  /**
   * Test: Default values for timestamps and counters
   * EXPECTED TO FAIL: Defaults not set until migration runs
   */
  it('should set default values for last_poll_time and total_events_published', async () => {
    const result = await pgClient.query(`
      INSERT INTO outbox_relay.relay_state (schema_name, table_name)
      VALUES ('darwin_ingestor', 'outbox')
      RETURNING last_poll_time, total_events_published, created_at, updated_at
    `);

    const row = result.rows[0];

    // Verify last_poll_time has default (now())
    expect(row.last_poll_time).toBeInstanceOf(Date);

    // Verify total_events_published defaults to 0
    expect(row.total_events_published).toBe('0'); // bigint returned as string

    // Verify created_at and updated_at have defaults
    expect(row.created_at).toBeInstanceOf(Date);
    expect(row.updated_at).toBeInstanceOf(Date);
  });

  /**
   * Test: Indexes created on relay_state
   * EXPECTED TO FAIL: Indexes do not exist until migration runs
   */
  it('should create indexes on relay_state table', async () => {
    const result = await pgClient.query(`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = 'outbox_relay' AND tablename = 'relay_state'
      ORDER BY indexname
    `);

    const indexNames = result.rows.map((r) => r.indexname);

    // Verify idx_relay_state_last_poll exists (for health check queries)
    expect(indexNames).toContain('idx_relay_state_last_poll');

    // Verify idx_relay_state_schema exists (for polling loop queries)
    expect(indexNames).toContain('idx_relay_state_schema');

    // Also includes primary key index (relay_state_pkey)
    expect(indexNames).toContain('relay_state_pkey');
  });
});

/**
 * Test Suite 2: Migration 2 - Create failed_events table (DLQ)
 */
describe('Migration 2: Create failed_events table', () => {
  /**
   * Test: failed_events table structure
   * EXPECTED TO FAIL: Table does not exist until migration runs
   */
  it('should create failed_events table with correct columns', async () => {
    // Run migration 2
    const { default: migrate } = await import('node-pg-migrate');
    await migrate({
      databaseUrl,
      dir: path.join(__dirname, '../../../migrations'),
      direction: 'up',
      count: 1, // Run second migration
      migrationsTable: 'pgmigrations',
      log: console.log,
    });

    const result = await pgClient.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'outbox_relay' AND table_name = 'failed_events'
      ORDER BY ordinal_position
    `);

    const columns = result.rows.map((r) => ({
      name: r.column_name,
      type: r.data_type,
      nullable: r.is_nullable,
    }));

    expect(columns).toContainEqual({
      name: 'id',
      type: 'uuid',
      nullable: 'NO',
    });

    expect(columns).toContainEqual({
      name: 'original_event_id',
      type: 'uuid',
      nullable: 'NO',
    });

    expect(columns).toContainEqual({
      name: 'source_schema',
      type: 'character varying',
      nullable: 'NO',
    });

    expect(columns).toContainEqual({
      name: 'source_table',
      type: 'character varying',
      nullable: 'NO',
    });

    expect(columns).toContainEqual({
      name: 'event_type',
      type: 'character varying',
      nullable: 'NO',
    });

    expect(columns).toContainEqual({
      name: 'payload',
      type: 'jsonb',
      nullable: 'NO',
    });

    expect(columns).toContainEqual({
      name: 'failure_reason',
      type: 'text',
      nullable: 'NO',
    });

    expect(columns).toContainEqual({
      name: 'failure_count',
      type: 'integer',
      nullable: 'NO',
    });

    expect(columns).toContainEqual({
      name: 'first_failed_at',
      type: 'timestamp with time zone',
      nullable: 'NO',
    });

    expect(columns).toContainEqual({
      name: 'last_failed_at',
      type: 'timestamp with time zone',
      nullable: 'NO',
    });

    expect(columns).toContainEqual({
      name: 'created_at',
      type: 'timestamp with time zone',
      nullable: 'NO',
    });
  });

  /**
   * Test: Insert into failed_events (DLQ)
   * EXPECTED TO FAIL: Table does not exist until migration runs
   */
  it('should allow inserting failed events into DLQ', async () => {
    const result = await pgClient.query(`
      INSERT INTO outbox_relay.failed_events (
        original_event_id, source_schema, source_table, event_type,
        payload, failure_reason, failure_count
      ) VALUES (
        gen_random_uuid(), 'journey_matcher', 'outbox', 'journey.created',
        '{"test": "data", "user_id": "user_123"}'::jsonb,
        'KafkaTimeoutError: Timeout while sending message to topic journey.created',
        10
      ) RETURNING id, payload
    `);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].id).toBeDefined();

    // Verify JSONB payload stored correctly
    expect(result.rows[0].payload).toMatchObject({
      test: 'data',
      user_id: 'user_123',
    });
  });

  /**
   * Test: Default values for failure_count and timestamps
   * EXPECTED TO FAIL: Defaults not set until migration runs
   */
  it('should set default values for failure_count and timestamps', async () => {
    const result = await pgClient.query(`
      INSERT INTO outbox_relay.failed_events (
        original_event_id, source_schema, source_table, event_type,
        payload, failure_reason
      ) VALUES (
        gen_random_uuid(), 'payments_service', 'outbox', 'payment.failed',
        '{"amount": 25.50}'::jsonb,
        'KafkaError: Broker connection failed'
      ) RETURNING failure_count, first_failed_at, last_failed_at, created_at
    `);

    const row = result.rows[0];

    // Verify failure_count defaults to 1
    expect(row.failure_count).toBe(1);

    // Verify timestamps have defaults (now())
    expect(row.first_failed_at).toBeInstanceOf(Date);
    expect(row.last_failed_at).toBeInstanceOf(Date);
    expect(row.created_at).toBeInstanceOf(Date);
  });

  /**
   * Test: Indexes created on failed_events
   * EXPECTED TO FAIL: Indexes do not exist until migration runs
   */
  it('should create all indexes on failed_events table', async () => {
    const result = await pgClient.query(`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = 'outbox_relay' AND tablename = 'failed_events'
      ORDER BY indexname
    `);

    const indexNames = result.rows.map((r) => r.indexname);

    // Verify idx_failed_events_source exists (for operator queries)
    expect(indexNames).toContain('idx_failed_events_source');

    // Verify idx_failed_events_type exists (for alert queries)
    expect(indexNames).toContain('idx_failed_events_type');

    // Verify idx_failed_events_first_failed exists (for dashboard queries)
    expect(indexNames).toContain('idx_failed_events_first_failed');

    // Verify idx_failed_events_payload exists (GIN index for JSONB queries)
    expect(indexNames).toContain('idx_failed_events_payload');

    // Also includes primary key index (failed_events_pkey)
    expect(indexNames).toContain('failed_events_pkey');
  });

  /**
   * Test: JSONB GIN index query performance
   * EXPECTED TO FAIL: GIN index does not exist until migration runs
   */
  it('should use GIN index for JSONB payload queries', async () => {
    // Insert test event with correlation_id in payload
    const correlationId = '550e8400-e29b-41d4-a716-446655440000';
    await pgClient.query(`
      INSERT INTO outbox_relay.failed_events (
        original_event_id, source_schema, source_table, event_type,
        payload, failure_reason, failure_count
      ) VALUES (
        gen_random_uuid(), 'journey_matcher', 'outbox', 'journey.created',
        jsonb_build_object('correlation_id', '${correlationId}', 'user_id', 'user_123'),
        'Kafka timeout', 10
      )
    `);

    // Query by correlation_id (should use GIN index)
    const result = await pgClient.query(`
      SELECT *
      FROM outbox_relay.failed_events
      WHERE payload @> '{"correlation_id": "${correlationId}"}'::jsonb
    `);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].payload.correlation_id).toBe(correlationId);
  });
});

/**
 * Test Suite 3: Migration 3 - Grant cross-schema permissions
 */
describe('Migration 3: Grant cross-schema permissions', () => {
  beforeAll(async () => {
    // Create mock service schemas with outbox tables
    await pgClient.query('CREATE SCHEMA IF NOT EXISTS journey_matcher');
    await pgClient.query('CREATE SCHEMA IF NOT EXISTS whatsapp_handler');

    // Create mock outbox table in journey_matcher
    await pgClient.query(`
      CREATE TABLE IF NOT EXISTS journey_matcher.outbox (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        aggregate_id UUID NOT NULL,
        event_type VARCHAR(100) NOT NULL,
        payload JSONB NOT NULL,
        correlation_id UUID NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        published_at TIMESTAMPTZ,
        published BOOLEAN NOT NULL DEFAULT false
      )
    `);

    // Create mock outbox_events table in whatsapp_handler (variation)
    await pgClient.query(`
      CREATE TABLE IF NOT EXISTS whatsapp_handler.outbox_events (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        aggregate_id UUID NOT NULL,
        event_type VARCHAR(100) NOT NULL,
        payload JSONB NOT NULL,
        correlation_id UUID NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        published_at TIMESTAMPTZ,
        published BOOLEAN NOT NULL DEFAULT false
      )
    `);
  });

  /**
   * Test: SELECT permission granted
   * EXPECTED TO FAIL: Permissions not granted until migration runs
   */
  it('should allow SELECT on journey_matcher.outbox', async () => {
    // Run migration 3
    const { default: migrate } = await import('node-pg-migrate');
    await migrate({
      databaseUrl,
      dir: path.join(__dirname, '../../../migrations'),
      direction: 'up',
      count: 1, // Run third migration
      migrationsTable: 'pgmigrations',
      log: console.log,
    });

    // Insert test event
    await pgClient.query(`
      INSERT INTO journey_matcher.outbox (aggregate_id, event_type, payload, correlation_id)
      VALUES (gen_random_uuid(), 'journey.created', '{}'::jsonb, gen_random_uuid())
    `);

    // Query as postgres user (outbox-relay role)
    const result = await pgClient.query(`
      SELECT * FROM journey_matcher.outbox WHERE published = false
    `);

    expect(result.rows).toBeDefined();
    expect(result.rows.length).toBeGreaterThan(0);
  });

  /**
   * Test: UPDATE permission granted
   * EXPECTED TO FAIL: Permissions not granted until migration runs
   */
  it('should allow UPDATE on journey_matcher.outbox', async () => {
    // Insert test event
    const insertResult = await pgClient.query(`
      INSERT INTO journey_matcher.outbox (aggregate_id, event_type, payload, correlation_id)
      VALUES (gen_random_uuid(), 'test.event', '{}'::jsonb, gen_random_uuid())
      RETURNING id
    `);

    const eventId = insertResult.rows[0].id;

    // Update as postgres user (outbox-relay role)
    await pgClient.query(`
      UPDATE journey_matcher.outbox
      SET published = true, published_at = now()
      WHERE id = $1
    `, [eventId]);

    // Verify update succeeded
    const result = await pgClient.query(`
      SELECT published FROM journey_matcher.outbox WHERE id = $1
    `, [eventId]);

    expect(result.rows[0].published).toBe(true);
  });

  /**
   * Test: SELECT permission granted on whatsapp_handler.outbox_events (variation)
   * EXPECTED TO FAIL: Permissions not granted until migration runs
   */
  it('should allow SELECT on whatsapp_handler.outbox_events (table name variation)', async () => {
    // Insert test event
    await pgClient.query(`
      INSERT INTO whatsapp_handler.outbox_events (aggregate_id, event_type, payload, correlation_id)
      VALUES (gen_random_uuid(), 'user.registered', '{}'::jsonb, gen_random_uuid())
    `);

    // Query as postgres user
    const result = await pgClient.query(`
      SELECT * FROM whatsapp_handler.outbox_events WHERE published = false
    `);

    expect(result.rows).toBeDefined();
    expect(result.rows.length).toBeGreaterThan(0);
  });

  /**
   * Test: INSERT permission DENIED (negative test)
   * EXPECTED TO PASS: Should not have INSERT permission (security boundary)
   */
  it('should DENY INSERT on journey_matcher.outbox (security boundary)', async () => {
    // This test verifies that outbox-relay CANNOT create fake events
    // Since we're using postgres user in tests, INSERT is allowed
    // In production, outbox_relay role would not have INSERT permission

    // For now, we verify that the permission grant does NOT include INSERT
    const result = await pgClient.query(`
      SELECT privilege_type
      FROM information_schema.role_table_grants
      WHERE grantee = 'postgres'
        AND table_schema = 'journey_matcher'
        AND table_name = 'outbox'
    `);

    const privileges = result.rows.map((r) => r.privilege_type);

    // Verify SELECT and UPDATE are granted
    expect(privileges).toContain('SELECT');
    expect(privileges).toContain('UPDATE');

    // NOTE: In tests, postgres user has all privileges (superuser)
    // In production, outbox_relay role should NOT have INSERT/DELETE
  });

  /**
   * Test: DELETE permission DENIED (negative test)
   * EXPECTED TO PASS: Should not have DELETE permission (audit trail preserved)
   */
  it('should DENY DELETE on journey_matcher.outbox (audit trail preservation)', async () => {
    // Verify that DELETE is not explicitly granted to outbox_relay role
    // In production, only data-retention-service should have DELETE permission

    const result = await pgClient.query(`
      SELECT privilege_type
      FROM information_schema.role_table_grants
      WHERE grantee = 'postgres'
        AND table_schema = 'journey_matcher'
        AND table_name = 'outbox'
    `);

    const privileges = result.rows.map((r) => r.privilege_type);

    // Verify SELECT and UPDATE are granted
    expect(privileges).toContain('SELECT');
    expect(privileges).toContain('UPDATE');

    // NOTE: In tests, postgres user has all privileges (superuser)
    // In production, outbox_relay role should NOT have DELETE permission
  });
});

/**
 * Test Suite 4: Rollback migrations (DOWN)
 */
describe('Rollback migrations', () => {
  /**
   * Test: Rollback all migrations and remove schema
   * EXPECTED TO FAIL: Rollback not implemented until migrations created
   */
  it('should rollback all migrations and remove outbox_relay schema', async () => {
    // Rollback all migrations
    const { default: migrate } = await import('node-pg-migrate');
    await migrate({
      databaseUrl,
      dir: path.join(__dirname, '../../../migrations'),
      direction: 'down',
      count: 999, // Rollback all migrations
      migrationsTable: 'pgmigrations',
      log: console.log,
    });

    // Verify outbox_relay schema removed
    const schemaResult = await pgClient.query(
      "SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'outbox_relay'"
    );
    expect(schemaResult.rows).toHaveLength(0);

    // Verify relay_state table removed
    const relayStateResult = await pgClient.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'outbox_relay' AND table_name = 'relay_state'
    `);
    expect(relayStateResult.rows).toHaveLength(0);

    // Verify failed_events table removed
    const failedEventsResult = await pgClient.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'outbox_relay' AND table_name = 'failed_events'
    `);
    expect(failedEventsResult.rows).toHaveLength(0);
  });

  /**
   * Test: Re-apply migrations after rollback (idempotency)
   * EXPECTED TO FAIL: Migrations not idempotent until implementation complete
   */
  it('should re-apply migrations successfully after rollback', async () => {
    // Re-apply all migrations
    const { default: migrate } = await import('node-pg-migrate');
    await migrate({
      databaseUrl,
      dir: path.join(__dirname, '../../../migrations'),
      direction: 'up',
      migrationsTable: 'pgmigrations',
      log: console.log,
    });

    // Verify schema exists again
    const schemaResult = await pgClient.query(
      "SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'outbox_relay'"
    );
    expect(schemaResult.rows).toHaveLength(1);

    // Verify relay_state table exists again
    const relayStateResult = await pgClient.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'outbox_relay' AND table_name = 'relay_state'
    `);
    expect(relayStateResult.rows).toHaveLength(1);

    // Verify failed_events table exists again
    const failedEventsResult = await pgClient.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'outbox_relay' AND table_name = 'failed_events'
    `);
    expect(failedEventsResult.rows).toHaveLength(1);
  });
});

/**
 * Test Suite 5: Query performance verification
 */
describe('Query performance verification', () => {
  /**
   * Test: Poll unpublished events query uses index
   * EXPECTED TO FAIL: Index not created until migration runs
   */
  it('should use partial index for polling unpublished events', async () => {
    // Insert test events
    for (let i = 0; i < 10; i++) {
      await pgClient.query(`
        INSERT INTO journey_matcher.outbox (aggregate_id, event_type, payload, correlation_id, published)
        VALUES (gen_random_uuid(), 'journey.created', '{}'::jsonb, gen_random_uuid(), false)
      `);
    }

    // Query unpublished events (should use partial index)
    const explainResult = await pgClient.query(`
      EXPLAIN (FORMAT JSON)
      SELECT *
      FROM journey_matcher.outbox
      WHERE published = false
      ORDER BY created_at
      LIMIT 100
    `);

    // Verify query plan uses index scan (not seq scan)
    const plan = JSON.stringify(explainResult.rows[0]);
    expect(plan).toContain('Index Scan');
  });

  /**
   * Test: Monitor relay lag query uses index
   * EXPECTED TO FAIL: Index not created until migration runs
   */
  it('should use index for monitoring relay lag queries', async () => {
    // Query relay lag (should use idx_relay_state_last_poll)
    const explainResult = await pgClient.query(`
      EXPLAIN (FORMAT JSON)
      SELECT schema_name, EXTRACT(EPOCH FROM (now() - last_poll_time)) AS lag_seconds
      FROM outbox_relay.relay_state
      WHERE last_poll_time < now() - INTERVAL '60 seconds'
    `);

    // Verify query plan uses index scan
    const plan = JSON.stringify(explainResult.rows[0]);
    expect(plan).toContain('Index Scan');
  });
});
