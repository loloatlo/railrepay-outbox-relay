/**
 * Outbox Relay Service - Main Application Entry Point
 *
 * This service implements the Transactional Outbox Pattern for exactly-once
 * event delivery from microservice outbox tables to Kafka.
 *
 * Key Features:
 * - Polls multiple schemas for unpublished events (schema-per-service pattern)
 * - Publishes events to Kafka with partition keys for ordering guarantee
 * - Exponential backoff retry logic (10 retries max per ADR-014)
 * - Dead-Letter Queue (DLQ) for failed events after max retries
 * - Health and metrics endpoints for observability
 *
 * Architecture:
 * - Express.js HTTP server for health/metrics endpoints
 * - PostgreSQL connection pool for multi-schema polling
 * - KafkaJS producer for event publishing
 * - Graceful shutdown on SIGTERM/SIGINT
 *
 * @see /services/outbox-relay/docs/rfcs/RFC-001-outbox-relay-schema.md
 * @see /services/outbox-relay/docs/phases/PHASE-1-SPECIFICATION.md
 */

import express, { type Express } from 'express';
import { Pool } from 'pg';
import { Kafka, type Producer } from 'kafkajs';
import { createLogger } from '@railrepay/winston-logger';
import { MetricsPusher } from '@railrepay/metrics-pusher';
import { createHealthRoutes } from './routes/health.routes.js';
import {
  createMetricsRoutes,
  incrementEventsPolled,
  incrementEventsPublished,
  incrementEventsFailed,
  recordPollLatency,
} from './routes/metrics.routes.js';
import { OutboxPoller, type SchemaConfig } from './services/outbox-poller.service.js';
import { KafkaPublisher } from './services/kafka-publisher.service.js';
import * as net from 'net';

/**
 * Create logger instance
 */
const logger = createLogger({
  serviceName: process.env.SERVICE_NAME || 'outbox-relay',
  level: process.env.LOG_LEVEL || 'info',
});

/**
 * Global state for graceful shutdown
 */
let dbPool: Pool | null = null;
let kafkaProducer: Producer | null = null;
let pollingIntervalId: NodeJS.Timeout | null = null;
let metricsPusher: MetricsPusher | null = null;

/**
 * Test TCP connectivity to Kafka brokers
 *
 * This diagnostic function tests connectivity to the bootstrap broker
 * and individual broker hostnames that Confluent Cloud returns in metadata.
 * Helps diagnose "This server does not host this topic-partition" errors.
 */
async function testBrokerConnectivity(): Promise<void> {
  logger.info('=== KAFKA BROKER CONNECTIVITY TEST ===');

  // Extract bootstrap hostname from env
  const bootstrapServer = process.env.KAFKA_BROKERS || 'localhost:9092';
  const [bootstrapHost] = bootstrapServer.split(':');

  // Known Confluent Cloud broker hostnames for pkc-l6wr6 cluster
  // These are the individual brokers that handle partition leadership
  const brokerHosts = [
    bootstrapHost,  // Bootstrap: pkc-l6wr6.europe-west2.gcp.confluent.cloud
    `b0-${bootstrapHost}`,
    `b1-${bootstrapHost}`,
    `b2-${bootstrapHost}`,
    `b3-${bootstrapHost}`,
    `b4-${bootstrapHost}`,
    `b5-${bootstrapHost}`,
    `b6-${bootstrapHost}`,
    `b7-${bootstrapHost}`,
    `b8-${bootstrapHost}`,
    `b9-${bootstrapHost}`,
    `b10-${bootstrapHost}`,
    `b11-${bootstrapHost}`,
    `b12-${bootstrapHost}`,
  ];

  const results: { host: string; reachable: boolean; error?: string }[] = [];

  for (const host of brokerHosts) {
    try {
      const reachable = await testTcpConnection(host, 9092, 5000);
      results.push({ host, reachable });
      if (reachable) {
        logger.info(`✅ REACHABLE: ${host}:9092`);
      } else {
        logger.error(`❌ UNREACHABLE (timeout): ${host}:9092`);
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      results.push({ host, reachable: false, error: errorMsg });
      logger.error(`❌ UNREACHABLE: ${host}:9092`, { error: errorMsg });
    }
  }

  // Summary
  const reachableCount = results.filter(r => r.reachable).length;
  const unreachableCount = results.filter(r => !r.reachable).length;

  logger.info('=== CONNECTIVITY TEST SUMMARY ===', {
    totalTested: results.length,
    reachable: reachableCount,
    unreachable: unreachableCount,
    unreachableBrokers: results.filter(r => !r.reachable).map(r => r.host),
  });

  if (unreachableCount > 0 && reachableCount > 0) {
    logger.warn('PARTIAL CONNECTIVITY: Some brokers unreachable. This causes "This server does not host this topic-partition" errors when partition leaders are on unreachable brokers.');
  } else if (unreachableCount === results.length) {
    logger.error('NO CONNECTIVITY: All brokers unreachable. Check DNS, firewall, and egress rules.');
  }
}

/**
 * Test TCP connection to a host:port with timeout
 */
function testTcpConnection(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let resolved = false;

    const cleanup = () => {
      if (!resolved) {
        resolved = true;
        socket.destroy();
      }
    };

    socket.setTimeout(timeoutMs);

    socket.on('connect', () => {
      cleanup();
      resolve(true);
    });

    socket.on('timeout', () => {
      cleanup();
      resolve(false);
    });

    socket.on('error', () => {
      cleanup();
      resolve(false);
    });

    socket.connect(port, host);
  });
}

/**
 * Create Express application with health and metrics routes
 *
 * @returns Express application instance
 */
export function createApp(): Express {
  const app = express();

  logger.info('Creating Express application');

  // Middleware: JSON body parser
  app.use(express.json());

  // Health check routes: /health/live, /health/ready
  if (dbPool) {
    app.use('/health', createHealthRoutes(dbPool));
  } else {
    logger.warn('Health routes initialized without database pool');
    // Create temporary pool for testing
    const tempPool = new Pool({
      host: process.env.PGHOST || 'localhost',
      port: parseInt(process.env.PGPORT || '5432', 10),
      database: process.env.PGDATABASE || 'railrepay',
      user: process.env.PGUSER || 'postgres',
      password: process.env.PGPASSWORD || 'postgres',
    });
    app.use('/health', createHealthRoutes(tempPool));
  }

  // Metrics routes: /metrics (Prometheus format)
  app.use('/metrics', createMetricsRoutes());

  logger.info('Express routes mounted', {
    routes: ['/health/live', '/health/ready', '/metrics'],
  });

  return app;
}

/**
 * Database configuration type
 */
export interface DatabaseConfig {
  PGHOST?: string;
  PGPORT?: string;
  PGDATABASE?: string;
  PGUSER?: string;
  PGPASSWORD?: string;
}

/**
 * Pool factory function type for dependency injection
 */
export type PoolFactory = (config: {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  max: number;
  idleTimeoutMillis: number;
  connectionTimeoutMillis: number;
}) => Pool;

/**
 * Initialize PostgreSQL connection pool
 *
 * @param config - Database configuration (defaults to process.env)
 * @param poolFactory - Pool factory function for dependency injection
 * @returns PostgreSQL Pool instance
 */
export async function initializeDatabase(
  config?: DatabaseConfig,
  poolFactory: PoolFactory = (poolConfig) => new Pool(poolConfig)
): Promise<Pool> {
  logger.info('Initializing PostgreSQL connection pool');

  const dbConfig = config || {
    PGHOST: process.env.PGHOST,
    PGPORT: process.env.PGPORT,
    PGDATABASE: process.env.PGDATABASE,
    PGUSER: process.env.PGUSER,
    PGPASSWORD: process.env.PGPASSWORD,
  };

  const pool = poolFactory({
    host: dbConfig.PGHOST || 'localhost',
    port: parseInt(dbConfig.PGPORT || '5432', 10),
    database: dbConfig.PGDATABASE || 'railrepay',
    user: dbConfig.PGUSER || 'postgres',
    password: dbConfig.PGPASSWORD || 'postgres',
    max: 20, // Maximum number of clients in pool
    idleTimeoutMillis: 30000, // Close idle clients after 30s
    connectionTimeoutMillis: 5000, // Fail fast if connection takes > 5s
  });

  // Test connection
  const client = await pool.connect();
  logger.info('PostgreSQL connection pool initialized', {
    host: dbConfig.PGHOST,
    database: dbConfig.PGDATABASE,
  });
  client.release();

  dbPool = pool;
  return pool;
}

/**
 * Kafka configuration type
 */
export interface KafkaConfig {
  KAFKA_BROKERS?: string;
  KAFKA_CLIENT_ID?: string;
  KAFKA_USERNAME?: string;
  KAFKA_PASSWORD?: string;
  KAFKA_SSL?: string;
  KAFKA_SASL_MECHANISM?: string;
}

/**
 * Producer factory function type for dependency injection
 */
export type ProducerFactory = (config: {
  clientId: string;
  brokers: string[];
  retry: { initialRetryTime: number; retries: number };
  ssl?: boolean;
  sasl?: { mechanism: 'plain'; username: string; password: string };
}) => { producer: () => Producer };

/**
 * Initialize Kafka producer
 *
 * @param config - Kafka configuration (defaults to process.env)
 * @param kafkaFactory - Kafka factory function for dependency injection
 * @returns KafkaJS Producer instance
 */
export async function initializeKafka(
  config?: KafkaConfig,
  kafkaFactory: ProducerFactory = (kafkaConfig) => new Kafka(kafkaConfig)
): Promise<Producer> {
  logger.info('Initializing Kafka producer');

  const kafkaConfig = config || {
    KAFKA_BROKERS: process.env.KAFKA_BROKERS,
    KAFKA_USERNAME: process.env.KAFKA_USERNAME,
    KAFKA_PASSWORD: process.env.KAFKA_PASSWORD,
    KAFKA_SSL: process.env.KAFKA_SSL,
    KAFKA_SASL_MECHANISM: process.env.KAFKA_SASL_MECHANISM,
  };

  // Build Kafka client configuration
  const kafkaClientConfig: {
    clientId: string;
    brokers: string[];
    retry: { initialRetryTime: number; retries: number };
    ssl?: boolean;
    sasl?: { mechanism: 'plain'; username: string; password: string };
  } = {
    clientId: 'outbox-relay',
    brokers: (kafkaConfig.KAFKA_BROKERS || 'localhost:9092').split(','),
    retry: {
      initialRetryTime: 100,
      retries: 8,
    },
  };

  // Add SSL if configured
  if (kafkaConfig.KAFKA_SSL === 'true') {
    kafkaClientConfig.ssl = true;
    logger.info('Kafka SSL enabled');
  }

  // Add SASL authentication if configured
  if (kafkaConfig.KAFKA_USERNAME && kafkaConfig.KAFKA_PASSWORD) {
    kafkaClientConfig.sasl = {
      mechanism: 'plain',
      username: kafkaConfig.KAFKA_USERNAME,
      password: kafkaConfig.KAFKA_PASSWORD,
    };
    logger.info('Kafka SASL authentication enabled');
  }

  const kafka = kafkaFactory(kafkaClientConfig);

  const producer = kafka.producer();

  await producer.connect();

  logger.info('Kafka producer connected', {
    brokers: kafkaConfig.KAFKA_BROKERS,
  });

  kafkaProducer = producer;
  return producer;
}

/**
 * Cleanup resources interface
 */
export interface CleanupResources {
  producer: Producer | null;
  pool: Pool | null;
}

/**
 * Process exit function type for dependency injection
 */
export type ProcessExitFn = (code: number) => void;

/**
 * Graceful shutdown handler
 *
 * Closes database pool and Kafka producer cleanly before process exit.
 *
 * @param resources - Resources to clean up (defaults to global state)
 * @param exitFn - Process exit function for dependency injection
 */
export async function gracefulShutdown(
  resources: CleanupResources = { producer: kafkaProducer, pool: dbPool },
  exitFn: ProcessExitFn = (code) => process.exit(code)
): Promise<void> {
  logger.info('Graceful shutdown initiated');

  try {
    // Stop polling loop
    if (pollingIntervalId) {
      logger.info('Stopping polling loop');
      clearTimeout(pollingIntervalId);
      pollingIntervalId = null;
    }

    // Stop metrics pusher
    if (metricsPusher) {
      logger.info('Stopping metrics pusher');
      metricsPusher.stop();
      metricsPusher = null;
    }

    // Close Kafka producer
    if (resources.producer) {
      logger.info('Disconnecting Kafka producer');
      await resources.producer.disconnect();
      kafkaProducer = null;
    }

    // Close database pool
    if (resources.pool) {
      logger.info('Closing PostgreSQL connection pool');
      await resources.pool.end();
      dbPool = null;
    }

    logger.info('Graceful shutdown completed');
    exitFn(0);
  } catch (error) {
    logger.error('Error during graceful shutdown', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    exitFn(1);
  }
}

/**
 * Schema configuration mapping
 * Maps schema names to their table names and timestamp columns
 */
const SCHEMA_TABLE_MAP: Record<string, { table: string; timestampColumn: 'published_at' | 'processed_at' }> = {
  whatsapp_handler: { table: 'outbox_events', timestampColumn: 'published_at' },
  darwin_ingestor: { table: 'outbox_events', timestampColumn: 'published_at' },
  journey_matcher: { table: 'outbox', timestampColumn: 'processed_at' },
  data_retention: { table: 'outbox', timestampColumn: 'published_at' },
  delay_tracker: { table: 'outbox', timestampColumn: 'processed_at' },
  evaluation_coordinator: { table: 'outbox', timestampColumn: 'published_at' }, // AC-11: BL-146
};

/**
 * Parse OUTBOX_SCHEMAS environment variable into schema configurations
 *
 * @returns Array of SchemaConfig objects
 */
export function parseSchemaConfigs(): SchemaConfig[] {
  const schemasEnv = process.env.OUTBOX_SCHEMAS || '';
  const schemaNames = schemasEnv.split(',').map(s => s.trim()).filter(Boolean);

  if (schemaNames.length === 0) {
    logger.warn('No OUTBOX_SCHEMAS configured, polling will be disabled');
    return [];
  }

  const configs: SchemaConfig[] = [];
  for (const schemaName of schemaNames) {
    const mapping = SCHEMA_TABLE_MAP[schemaName];
    if (mapping) {
      configs.push({
        schema: schemaName,
        table: mapping.table,
        timestampColumn: mapping.timestampColumn,
      });
    } else {
      logger.warn('Unknown schema in OUTBOX_SCHEMAS, using defaults', {
        schema: schemaName,
        defaultTable: 'outbox_events',
        defaultTimestampColumn: 'published_at',
      });
      configs.push({
        schema: schemaName,
        table: 'outbox_events',
        timestampColumn: 'published_at',
      });
    }
  }

  return configs;
}

/**
 * Start the polling loop
 *
 * Polls each configured schema for unpublished events and publishes them to Kafka.
 *
 * @param pool - PostgreSQL connection pool
 * @param producer - Kafka producer
 * @param intervalMs - Polling interval in milliseconds (default: 1000)
 */
function startPollingLoop(pool: Pool, producer: Producer, intervalMs: number = 1000): void {
  const schemaConfigs = parseSchemaConfigs();

  if (schemaConfigs.length === 0) {
    logger.warn('Polling loop not started: no schemas configured');
    return;
  }

  const poller = new OutboxPoller(pool, { schemas: schemaConfigs, batchSize: 100 });
  const publisher = new KafkaPublisher(producer, pool);

  logger.info('Starting polling loop', {
    schemas: schemaConfigs.map(s => `${s.schema}.${s.table}`),
    intervalMs,
  });

  // Single poll iteration
  const pollOnce = async (): Promise<void> => {
    for (const config of schemaConfigs) {
      const pollStartTime = Date.now();
      try {
        const events = await poller.poll(config.schema, config.table, config.timestampColumn);

        // Record poll latency
        const pollDurationSeconds = (Date.now() - pollStartTime) / 1000;
        recordPollLatency(config.schema, config.table, pollDurationSeconds);

        // Increment polled counter for each event
        for (const event of events) {
          incrementEventsPolled(config.schema, config.table);
          try {
            await publisher.publish(event, config.schema, config.table, config.timestampColumn);
            // Increment published counter on success
            incrementEventsPublished(config.schema, config.table, event.event_type);
          } catch (publishError) {
            // Increment failed counter on error
            incrementEventsFailed(config.schema, config.table, event.event_type);
            logger.error('Failed to publish event', {
              eventId: event.id,
              schema: config.schema,
              error: publishError instanceof Error ? publishError.message : 'Unknown error',
            });
            // Continue with next event
          }
        }
      } catch (pollError) {
        // Record poll latency even on failure
        const pollDurationSeconds = (Date.now() - pollStartTime) / 1000;
        recordPollLatency(config.schema, config.table, pollDurationSeconds);
        logger.error('Failed to poll schema', {
          schema: config.schema,
          error: pollError instanceof Error ? pollError.message : 'Unknown error',
        });
        // Continue with next schema
      }
    }
  };

  // Recursive setTimeout: schedule next poll only AFTER current poll completes.
  // This prevents poll stacking when pollOnce() takes longer than intervalMs.
  const scheduleNextPoll = (): void => {
    pollingIntervalId = setTimeout(async () => {
      try {
        await pollOnce();
      } catch (error) {
        logger.error('Polling iteration failed', {
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
      // Schedule next poll only after this one finishes
      scheduleNextPoll();
    }, intervalMs);
  };

  // Run immediately on startup, then begin recurring schedule
  pollOnce()
    .catch(error => {
      logger.error('Initial poll failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    })
    .finally(() => {
      scheduleNextPoll();
    });
}

/**
 * Main application dependencies for dependency injection
 */
export interface MainDependencies {
  initDb?: typeof initializeDatabase;
  initKafka?: typeof initializeKafka;
  createApp?: typeof createApp;
  onShutdown?: () => void;
  exitFn?: ProcessExitFn;
  port?: number;
}

/**
 * Main application startup
 *
 * Initializes database, Kafka, Express server, and polling loop.
 *
 * @param deps - Dependencies for testing
 */
export async function main(deps: MainDependencies = {}): Promise<void> {
  const {
    initDb = initializeDatabase,
    initKafka = initializeKafka,
    createApp: createAppFn = createApp,
    onShutdown = gracefulShutdown,
    exitFn = (code) => process.exit(code),
    port = parseInt(process.env.PORT || '3000', 10),
  } = deps;

  try {
    logger.info('Starting outbox-relay service');

    // Run broker connectivity diagnostics before connecting
    await testBrokerConnectivity();

    // Initialize database pool
    const pool = await initDb();

    // Initialize Kafka producer
    const producer = await initKafka();

    // Initialize metrics pusher (push to Alloy gateway)
    if (process.env.ALLOY_PUSH_URL) {
      metricsPusher = new MetricsPusher({
        serviceName: process.env.SERVICE_NAME || 'outbox-relay',
        alloyUrl: process.env.ALLOY_PUSH_URL,
        pushInterval: parseInt(process.env.METRICS_PUSH_INTERVAL || '15', 10),
      });
      await metricsPusher.start();
      logger.info('Metrics pusher started', { alloyUrl: process.env.ALLOY_PUSH_URL });
    }

    // Create Express app
    const app = createAppFn();

    // Start HTTP server
    app.listen(port, () => {
      logger.info('HTTP server listening', { port });
    });

    // Start the polling loop
    const pollingInterval = parseInt(process.env.POLLING_INTERVAL_MS || '1000', 10);
    startPollingLoop(pool, producer, pollingInterval);

    // Register graceful shutdown handlers
    process.on('SIGTERM', onShutdown);
    process.on('SIGINT', onShutdown);

    logger.info('Outbox-relay service started successfully');
  } catch (error) {
    logger.error('Failed to start outbox-relay service', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    exitFn(1);
  }
}

// Start the application if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    logger.error('Unhandled error in main', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    process.exit(1);
  });
}
