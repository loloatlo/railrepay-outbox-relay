/**
 * Unit tests for SCHEMA_TABLE_MAP Configuration (BL-146)
 *
 * Phase: TD-1 Test Specification (Jessie)
 * Author: Jessie (QA Engineer)
 * Date: 2026-02-15
 *
 * PURPOSE:
 * Tests for the SCHEMA_TABLE_MAP configuration to ensure evaluation_coordinator
 * is correctly configured for outbox polling. This is a config-level test.
 *
 * ACCEPTANCE CRITERIA COVERAGE:
 * - AC-11: outbox-relay SCHEMA_TABLE_MAP configuration for evaluation_coordinator
 */

import { describe, it, expect } from 'vitest';
import { parseSchemaConfigs } from '../../src/index.js';

describe('BL-146: SCHEMA_TABLE_MAP - evaluation_coordinator Configuration', () => {
  /**
   * AC-11: SCHEMA_TABLE_MAP includes evaluation_coordinator entry
   */
  it('should include evaluation_coordinator in SCHEMA_TABLE_MAP with correct table and timestamp column', async () => {
    // Arrange
    // Import the SCHEMA_TABLE_MAP from the module
    // NOTE: This test will fail until Blake adds the entry to SCHEMA_TABLE_MAP
    const { default: indexModule } = await import('../../src/index.js');

    // We can't directly import SCHEMA_TABLE_MAP (it's not exported), so we'll test via parseSchemaConfigs
    // which uses SCHEMA_TABLE_MAP internally

    // Set up environment variable with evaluation_coordinator included
    process.env.OUTBOX_SCHEMAS = 'whatsapp_handler,darwin_ingestor,journey_matcher,data_retention,delay_tracker,evaluation_coordinator';

    // Act
    const schemaConfigs = parseSchemaConfigs();

    // Assert - AC-11: evaluation_coordinator config exists
    const evalCoordinatorConfig = schemaConfigs.find(config => config.schema === 'evaluation_coordinator');

    expect(evalCoordinatorConfig).toBeDefined();
    expect(evalCoordinatorConfig?.schema).toBe('evaluation_coordinator');
    expect(evalCoordinatorConfig?.table).toBe('outbox');
    expect(evalCoordinatorConfig?.timestampColumn).toBe('published_at');
  });

  /**
   * AC-11: evaluation_coordinator uses 'outbox' table (not 'outbox_events')
   */
  it('should configure evaluation_coordinator with outbox table name', async () => {
    // Arrange
    process.env.OUTBOX_SCHEMAS = 'evaluation_coordinator';

    // Act
    const schemaConfigs = parseSchemaConfigs();

    // Assert - AC-11: Table name is 'outbox'
    const evalCoordinatorConfig = schemaConfigs.find(config => config.schema === 'evaluation_coordinator');
    expect(evalCoordinatorConfig?.table).toBe('outbox');
    // NOT 'outbox_events' (which whatsapp_handler uses)
  });

  /**
   * AC-11: evaluation_coordinator uses 'published_at' timestamp column
   */
  it('should configure evaluation_coordinator with published_at timestamp column', async () => {
    // Arrange
    process.env.OUTBOX_SCHEMAS = 'evaluation_coordinator';

    // Act
    const schemaConfigs = parseSchemaConfigs();

    // Assert - AC-11: Timestamp column is 'published_at'
    const evalCoordinatorConfig = schemaConfigs.find(config => config.schema === 'evaluation_coordinator');
    expect(evalCoordinatorConfig?.timestampColumn).toBe('published_at');
    // NOT 'processed_at' (which journey_matcher uses)
  });

  /**
   * Integration: All services including evaluation_coordinator can be parsed
   */
  it('should parse all 6 schemas including evaluation_coordinator from OUTBOX_SCHEMAS', async () => {
    // Arrange - All services deployed plus evaluation_coordinator
    process.env.OUTBOX_SCHEMAS = 'whatsapp_handler,darwin_ingestor,journey_matcher,data_retention,delay_tracker,evaluation_coordinator';

    // Act
    const schemaConfigs = parseSchemaConfigs();

    // Assert - All 6 services present
    expect(schemaConfigs).toHaveLength(6);

    const schemaNames = schemaConfigs.map(config => config.schema);
    expect(schemaNames).toContain('whatsapp_handler');
    expect(schemaNames).toContain('darwin_ingestor');
    expect(schemaNames).toContain('journey_matcher');
    expect(schemaNames).toContain('data_retention');
    expect(schemaNames).toContain('delay_tracker');
    expect(schemaNames).toContain('evaluation_coordinator'); // AC-11: NEW entry
  });

  /**
   * Edge Case: evaluation_coordinator as only schema in OUTBOX_SCHEMAS
   */
  it('should work when evaluation_coordinator is the only schema', async () => {
    // Arrange
    process.env.OUTBOX_SCHEMAS = 'evaluation_coordinator';

    // Act
    const schemaConfigs = parseSchemaConfigs();

    // Assert
    expect(schemaConfigs).toHaveLength(1);
    expect(schemaConfigs[0].schema).toBe('evaluation_coordinator');
    expect(schemaConfigs[0].table).toBe('outbox');
    expect(schemaConfigs[0].timestampColumn).toBe('published_at');
  });

  /**
   * Edge Case: Missing evaluation_coordinator from OUTBOX_SCHEMAS (before deployment)
   */
  it('should return empty config when evaluation_coordinator is not in OUTBOX_SCHEMAS', async () => {
    // Arrange - Old OUTBOX_SCHEMAS value before BL-146 deployment
    process.env.OUTBOX_SCHEMAS = 'whatsapp_handler,darwin_ingestor,journey_matcher,data_retention,delay_tracker';

    // Act
    const schemaConfigs = parseSchemaConfigs();

    // Assert - evaluation_coordinator NOT present (expected before BL-146 deployment)
    const schemaNames = schemaConfigs.map(config => config.schema);
    expect(schemaNames).not.toContain('evaluation_coordinator');
  });

  /**
   * Verification: Confirm other schemas still configured correctly (regression check)
   */
  it('should not break existing schema configurations when evaluation_coordinator is added', async () => {
    // Arrange - All schemas including new evaluation_coordinator
    process.env.OUTBOX_SCHEMAS = 'whatsapp_handler,darwin_ingestor,journey_matcher,data_retention,delay_tracker,evaluation_coordinator';

    // Act
    const schemaConfigs = parseSchemaConfigs();

    // Assert - Existing schemas still work correctly
    const whatsappConfig = schemaConfigs.find(config => config.schema === 'whatsapp_handler');
    expect(whatsappConfig?.table).toBe('outbox_events');
    expect(whatsappConfig?.timestampColumn).toBe('published_at');

    const journeyMatcherConfig = schemaConfigs.find(config => config.schema === 'journey_matcher');
    expect(journeyMatcherConfig?.table).toBe('outbox');
    expect(journeyMatcherConfig?.timestampColumn).toBe('processed_at');

    const delayTrackerConfig = schemaConfigs.find(config => config.schema === 'delay_tracker');
    expect(delayTrackerConfig?.table).toBe('outbox');
    expect(delayTrackerConfig?.timestampColumn).toBe('processed_at');
  });
});
