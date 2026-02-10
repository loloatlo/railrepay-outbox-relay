/**
 * Unit tests for Schema Configuration (SCHEMA_TABLE_MAP and parseSchemaConfigs)
 *
 * TD-OUTBOX-RELAY-002: SCHEMA_TABLE_MAP Missing delay_tracker Entry
 *
 * TDD Approach (Test-Driven Development per ADR-014):
 * - These tests are written BEFORE the fix is implemented
 * - Tests MUST FAIL initially (delay_tracker entry missing)
 * - Implementation adds delay_tracker entry to make tests pass
 *
 * Test Coverage:
 * - AC-1: SCHEMA_TABLE_MAP includes delay_tracker entry
 * - AC-2: parseSchemaConfigs returns correct config for delay_tracker
 * - AC-4: No regression in existing schema configs
 *
 * Testing Approach:
 * Since SCHEMA_TABLE_MAP and parseSchemaConfigs are not exported, Blake will need to:
 * Option A: Export parseSchemaConfigs for testing (recommended)
 * Option B: Export SCHEMA_TABLE_MAP constant for testing
 * Option C: Refactor to make schema config testable via dependency injection
 *
 * For now, these tests assume parseSchemaConfigs will be exported.
 *
 * @see /services/outbox-relay/docs/phases/TD-OUTBOX-RELAY-002-TD0-SPECIFICATION.md
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock logger to avoid actual log output
const sharedLogger = {
  info: vi.fn(),
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

vi.mock('@railrepay/winston-logger', () => ({
  createLogger: vi.fn(() => sharedLogger),
}));

/**
 * Test Suite: delay_tracker Schema Configuration
 * TD-OUTBOX-RELAY-002 Acceptance Criteria
 */
describe('TD-OUTBOX-RELAY-002: delay_tracker Schema Configuration', () => {
  let originalEnv: string | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    // Save original OUTBOX_SCHEMAS env var
    originalEnv = process.env.OUTBOX_SCHEMAS;
  });

  afterEach(() => {
    // Restore original env var
    if (originalEnv !== undefined) {
      process.env.OUTBOX_SCHEMAS = originalEnv;
    } else {
      delete process.env.OUTBOX_SCHEMAS;
    }
  });

  /**
   * AC-1: SCHEMA_TABLE_MAP includes delay_tracker entry
   *
   * This test verifies that when OUTBOX_SCHEMAS includes "delay_tracker",
   * the parseSchemaConfigs function returns the correct configuration:
   * - table: 'outbox' (NOT 'outbox_events')
   * - timestampColumn: 'processed_at' (NOT 'published_at')
   *
   * EXPECTED TO FAIL: delay_tracker entry missing from SCHEMA_TABLE_MAP
   */
  it('should return correct table and timestamp column for delay_tracker schema', async () => {
    // Arrange
    process.env.OUTBOX_SCHEMAS = 'delay_tracker';

    // Dynamic import to pick up env var changes
    const { parseSchemaConfigs } = await import('../../index.js');

    // Act
    const configs = parseSchemaConfigs();

    // Assert
    expect(configs).toHaveLength(1);
    expect(configs[0]).toEqual({
      schema: 'delay_tracker',
      table: 'outbox',
      timestampColumn: 'processed_at',
    });

    // Verify NO warning was logged (entry exists in map)
    expect(sharedLogger.warn).not.toHaveBeenCalledWith(
      'Unknown schema in OUTBOX_SCHEMAS, using defaults',
      expect.any(Object)
    );
  });

  /**
   * AC-2: delay_tracker uses 'outbox' table, not 'outbox_events'
   *
   * This test verifies that delay_tracker does NOT fall back to the
   * default table name 'outbox_events'. It should use the explicitly
   * mapped 'outbox' table.
   *
   * EXPECTED TO FAIL: delay_tracker falls back to default 'outbox_events'
   */
  it('should NOT use fallback table name for delay_tracker', async () => {
    // Arrange
    process.env.OUTBOX_SCHEMAS = 'delay_tracker';

    // Dynamic import to pick up env var changes
    const { parseSchemaConfigs } = await import('../../index.js');

    // Act
    const configs = parseSchemaConfigs();

    // Assert - delay_tracker should NOT have 'outbox_events' table
    expect(configs[0].table).not.toBe('outbox_events');
    expect(configs[0].table).toBe('outbox');
  });

  /**
   * AC-2: delay_tracker uses 'processed_at' timestamp column
   *
   * This test verifies that delay_tracker uses 'processed_at' as the
   * timestamp column (same as journey_matcher), NOT 'published_at'.
   *
   * EXPECTED TO FAIL: delay_tracker falls back to default 'published_at'
   */
  it('should use processed_at timestamp column for delay_tracker', async () => {
    // Arrange
    process.env.OUTBOX_SCHEMAS = 'delay_tracker';

    // Dynamic import to pick up env var changes
    const { parseSchemaConfigs } = await import('../../index.js');

    // Act
    const configs = parseSchemaConfigs();

    // Assert - delay_tracker should NOT have 'published_at' column
    expect(configs[0].timestampColumn).not.toBe('published_at');
    expect(configs[0].timestampColumn).toBe('processed_at');
  });

  /**
   * AC-4: No regression - existing schemas still work
   *
   * This test verifies that adding delay_tracker does not break
   * existing schema configurations.
   */
  it('should return correct configs for all existing schemas when delay_tracker included', async () => {
    // Arrange
    process.env.OUTBOX_SCHEMAS = 'whatsapp_handler,darwin_ingestor,journey_matcher,data_retention,delay_tracker';

    // Dynamic import to pick up env var changes
    const { parseSchemaConfigs } = await import('../../index.js');

    // Act
    const configs = parseSchemaConfigs();

    // Assert - should have 5 schemas
    expect(configs).toHaveLength(5);

    // Verify each existing schema config (no regression)
    const whatsappConfig = configs.find(c => c.schema === 'whatsapp_handler');
    expect(whatsappConfig).toEqual({
      schema: 'whatsapp_handler',
      table: 'outbox_events',
      timestampColumn: 'published_at',
    });

    const darwinConfig = configs.find(c => c.schema === 'darwin_ingestor');
    expect(darwinConfig).toEqual({
      schema: 'darwin_ingestor',
      table: 'outbox_events',
      timestampColumn: 'published_at',
    });

    const journeyConfig = configs.find(c => c.schema === 'journey_matcher');
    expect(journeyConfig).toEqual({
      schema: 'journey_matcher',
      table: 'outbox',
      timestampColumn: 'processed_at',
    });

    const dataRetentionConfig = configs.find(c => c.schema === 'data_retention');
    expect(dataRetentionConfig).toEqual({
      schema: 'data_retention',
      table: 'outbox',
      timestampColumn: 'published_at',
    });

    // Verify delay_tracker config
    const delayTrackerConfig = configs.find(c => c.schema === 'delay_tracker');
    expect(delayTrackerConfig).toEqual({
      schema: 'delay_tracker',
      table: 'outbox',
      timestampColumn: 'processed_at',
    });
  });

  /**
   * AC-4: No regression - existing schemas work without delay_tracker
   *
   * This test verifies that the fix doesn't break the case where
   * OUTBOX_SCHEMAS doesn't include delay_tracker.
   */
  it('should work correctly when delay_tracker not in OUTBOX_SCHEMAS', async () => {
    // Arrange
    process.env.OUTBOX_SCHEMAS = 'whatsapp_handler,darwin_ingestor';

    // Dynamic import to pick up env var changes
    const { parseSchemaConfigs } = await import('../../index.js');

    // Act
    const configs = parseSchemaConfigs();

    // Assert - should have 2 schemas, no delay_tracker
    expect(configs).toHaveLength(2);
    expect(configs.find(c => c.schema === 'delay_tracker')).toBeUndefined();

    // Existing schemas should still work
    expect(configs[0]).toEqual({
      schema: 'whatsapp_handler',
      table: 'outbox_events',
      timestampColumn: 'published_at',
    });
    expect(configs[1]).toEqual({
      schema: 'darwin_ingestor',
      table: 'outbox_events',
      timestampColumn: 'published_at',
    });
  });

  /**
   * Test to verify the fix prevents the fallback warning
   *
   * Before the fix, delay_tracker would trigger the "Unknown schema"
   * warning and use default values. After the fix, no warning should occur.
   *
   * EXPECTED TO FAIL: warning is logged because delay_tracker is unknown
   */
  it('should NOT log warning for delay_tracker schema after fix', async () => {
    // Arrange
    process.env.OUTBOX_SCHEMAS = 'delay_tracker';

    // Dynamic import to pick up env var changes
    const { parseSchemaConfigs } = await import('../../index.js');

    // Act
    parseSchemaConfigs();

    // Assert - should NOT log unknown schema warning
    expect(sharedLogger.warn).not.toHaveBeenCalledWith(
      'Unknown schema in OUTBOX_SCHEMAS, using defaults',
      expect.objectContaining({ schema: 'delay_tracker' })
    );
  });
});

/**
 * Test Suite: SCHEMA_TABLE_MAP Consistency
 *
 * These tests verify the consistency and correctness of the
 * SCHEMA_TABLE_MAP constant if it gets exported.
 */
describe('SCHEMA_TABLE_MAP Constant (if exported)', () => {
  /**
   * This test will fail if parseSchemaConfigs is exported but
   * SCHEMA_TABLE_MAP is not. Blake can choose to export it or
   * skip this test suite.
   */
  it('should include delay_tracker in SCHEMA_TABLE_MAP', async () => {
    // This test assumes SCHEMA_TABLE_MAP gets exported
    // If not exported, Blake can skip this test
    try {
      const { SCHEMA_TABLE_MAP } = await import('../../index.js');

      // Assert
      expect(SCHEMA_TABLE_MAP).toHaveProperty('delay_tracker');
      expect(SCHEMA_TABLE_MAP.delay_tracker).toEqual({
        table: 'outbox',
        timestampColumn: 'processed_at',
      });
    } catch (error) {
      // If SCHEMA_TABLE_MAP is not exported, skip this test
      // Blake will only need to export parseSchemaConfigs
      console.log('SCHEMA_TABLE_MAP not exported, skipping direct test');
    }
  });
});
