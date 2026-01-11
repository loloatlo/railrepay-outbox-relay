/**
 * Unit tests for Startup Functions (index.ts)
 *
 * This file tests the refactored startup functions with dependency injection
 * to achieve ≥80% function coverage per ADR-014.
 *
 * Test Coverage:
 * - initializeDatabase with mocked pool factory
 * - initializeKafka with mocked Kafka factory
 * - gracefulShutdown with mocked resources
 * - main function with mocked dependencies
 *
 * @see ADR-014 Testing Strategy 2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Pool } from 'pg';
import type { Producer } from 'kafkajs';
import {
  initializeDatabase,
  initializeKafka,
  gracefulShutdown,
  main,
  type DatabaseConfig,
  type PoolFactory,
  type KafkaConfig,
  type ProducerFactory,
  type CleanupResources,
  type ProcessExitFn,
  type MainDependencies,
} from '../../index.js';

// Mock logger to avoid actual log output
vi.mock('@railrepay/winston-logger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

/**
 * Test Suite: initializeDatabase
 */
describe('initializeDatabase', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create pool with correct connection string from config', async () => {
    // Arrange
    const mockClient = {
      query: vi.fn(),
      release: vi.fn(),
    };

    const mockPool = {
      connect: vi.fn().mockResolvedValue(mockClient),
      end: vi.fn().mockResolvedValue(undefined),
    } as unknown as Pool;

    const mockPoolFactory: PoolFactory = vi.fn().mockReturnValue(mockPool);

    const config: DatabaseConfig = {
      PGHOST: 'test-host',
      PGPORT: '5433',
      PGDATABASE: 'test-db',
      PGUSER: 'test-user',
      PGPASSWORD: 'test-pass',
    };

    // Act
    const result = await initializeDatabase(config, mockPoolFactory);

    // Assert
    expect(mockPoolFactory).toHaveBeenCalledWith({
      host: 'test-host',
      port: 5433,
      database: 'test-db',
      user: 'test-user',
      password: 'test-pass',
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });
    expect(result).toBe(mockPool);
    expect(mockPool.connect).toHaveBeenCalled();
    expect(mockClient.release).toHaveBeenCalled();
  });

  it('should use default values when config is empty', async () => {
    // Arrange
    const mockClient = {
      query: vi.fn(),
      release: vi.fn(),
    };

    const mockPool = {
      connect: vi.fn().mockResolvedValue(mockClient),
      end: vi.fn().mockResolvedValue(undefined),
    } as unknown as Pool;

    const mockPoolFactory: PoolFactory = vi.fn().mockReturnValue(mockPool);

    const config: DatabaseConfig = {};

    // Act
    await initializeDatabase(config, mockPoolFactory);

    // Assert
    expect(mockPoolFactory).toHaveBeenCalledWith({
      host: 'localhost',
      port: 5432,
      database: 'railrepay',
      user: 'postgres',
      password: 'postgres',
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });
  });

  it('should throw error when pool connection fails', async () => {
    // Arrange
    const mockPool = {
      connect: vi.fn().mockRejectedValue(new Error('Connection refused')),
      end: vi.fn().mockResolvedValue(undefined),
    } as unknown as Pool;

    const mockPoolFactory: PoolFactory = vi.fn().mockReturnValue(mockPool);

    // Act & Assert
    await expect(
      initializeDatabase({}, mockPoolFactory)
    ).rejects.toThrow('Connection refused');
  });

  it('should parse PGPORT as integer', async () => {
    // Arrange
    const mockClient = {
      query: vi.fn(),
      release: vi.fn(),
    };

    const mockPool = {
      connect: vi.fn().mockResolvedValue(mockClient),
      end: vi.fn().mockResolvedValue(undefined),
    } as unknown as Pool;

    const mockPoolFactory: PoolFactory = vi.fn().mockReturnValue(mockPool);

    const config: DatabaseConfig = {
      PGPORT: '9999',
    };

    // Act
    await initializeDatabase(config, mockPoolFactory);

    // Assert
    expect(mockPoolFactory).toHaveBeenCalledWith(
      expect.objectContaining({ port: 9999 })
    );
  });
});

/**
 * Test Suite: initializeKafka
 */
describe('initializeKafka', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create Kafka producer with correct brokers from config', async () => {
    // Arrange
    const mockProducer = {
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
    } as unknown as Producer;

    const mockKafka = {
      producer: vi.fn().mockReturnValue(mockProducer),
    };

    const mockKafkaFactory: ProducerFactory = vi.fn().mockReturnValue(mockKafka);

    const config: KafkaConfig = {
      KAFKA_BROKERS: 'broker1:9092,broker2:9092',
    };

    // Act
    const result = await initializeKafka(config, mockKafkaFactory);

    // Assert
    expect(mockKafkaFactory).toHaveBeenCalledWith({
      clientId: 'outbox-relay',
      brokers: ['broker1:9092', 'broker2:9092'],
      retry: {
        initialRetryTime: 100,
        retries: 8,
      },
    });
    expect(result).toBe(mockProducer);
    expect(mockProducer.connect).toHaveBeenCalled();
  });

  it('should use default broker when config is empty', async () => {
    // Arrange
    const mockProducer = {
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
    } as unknown as Producer;

    const mockKafka = {
      producer: vi.fn().mockReturnValue(mockProducer),
    };

    const mockKafkaFactory: ProducerFactory = vi.fn().mockReturnValue(mockKafka);

    const config: KafkaConfig = {};

    // Act
    await initializeKafka(config, mockKafkaFactory);

    // Assert
    expect(mockKafkaFactory).toHaveBeenCalledWith({
      clientId: 'outbox-relay',
      brokers: ['localhost:9092'],
      retry: {
        initialRetryTime: 100,
        retries: 8,
      },
    });
  });

  it('should throw error when producer connection fails', async () => {
    // Arrange
    const mockProducer = {
      connect: vi.fn().mockRejectedValue(new Error('Broker not available')),
      disconnect: vi.fn().mockResolvedValue(undefined),
    } as unknown as Producer;

    const mockKafka = {
      producer: vi.fn().mockReturnValue(mockProducer),
    };

    const mockKafkaFactory: ProducerFactory = vi.fn().mockReturnValue(mockKafka);

    // Act & Assert
    await expect(
      initializeKafka({}, mockKafkaFactory)
    ).rejects.toThrow('Broker not available');
  });

  it('should split multiple brokers correctly', async () => {
    // Arrange
    const mockProducer = {
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
    } as unknown as Producer;

    const mockKafka = {
      producer: vi.fn().mockReturnValue(mockProducer),
    };

    const mockKafkaFactory: ProducerFactory = vi.fn().mockReturnValue(mockKafka);

    const config: KafkaConfig = {
      KAFKA_BROKERS: 'broker1:9092,broker2:9092,broker3:9092',
    };

    // Act
    await initializeKafka(config, mockKafkaFactory);

    // Assert
    expect(mockKafkaFactory).toHaveBeenCalledWith(
      expect.objectContaining({
        brokers: ['broker1:9092', 'broker2:9092', 'broker3:9092'],
      })
    );
  });
});

/**
 * Test Suite: gracefulShutdown
 */
describe('gracefulShutdown', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should disconnect producer and close pool on graceful shutdown', async () => {
    // Arrange
    const mockProducer = {
      disconnect: vi.fn().mockResolvedValue(undefined),
    } as unknown as Producer;

    const mockPool = {
      end: vi.fn().mockResolvedValue(undefined),
    } as unknown as Pool;

    const mockExitFn: ProcessExitFn = vi.fn();

    const resources: CleanupResources = {
      producer: mockProducer,
      pool: mockPool,
    };

    // Act
    await gracefulShutdown(resources, mockExitFn);

    // Assert
    expect(mockProducer.disconnect).toHaveBeenCalled();
    expect(mockPool.end).toHaveBeenCalled();
    expect(mockExitFn).toHaveBeenCalledWith(0);
  });

  it('should handle null producer gracefully', async () => {
    // Arrange
    const mockPool = {
      end: vi.fn().mockResolvedValue(undefined),
    } as unknown as Pool;

    const mockExitFn: ProcessExitFn = vi.fn();

    const resources: CleanupResources = {
      producer: null,
      pool: mockPool,
    };

    // Act
    await gracefulShutdown(resources, mockExitFn);

    // Assert
    expect(mockPool.end).toHaveBeenCalled();
    expect(mockExitFn).toHaveBeenCalledWith(0);
  });

  it('should handle null pool gracefully', async () => {
    // Arrange
    const mockProducer = {
      disconnect: vi.fn().mockResolvedValue(undefined),
    } as unknown as Producer;

    const mockExitFn: ProcessExitFn = vi.fn();

    const resources: CleanupResources = {
      producer: mockProducer,
      pool: null,
    };

    // Act
    await gracefulShutdown(resources, mockExitFn);

    // Assert
    expect(mockProducer.disconnect).toHaveBeenCalled();
    expect(mockExitFn).toHaveBeenCalledWith(0);
  });

  it('should exit with code 1 when producer disconnect fails', async () => {
    // Arrange
    const mockProducer = {
      disconnect: vi.fn().mockRejectedValue(new Error('Disconnect failed')),
    } as unknown as Producer;

    const mockPool = {
      end: vi.fn().mockResolvedValue(undefined),
    } as unknown as Pool;

    const mockExitFn: ProcessExitFn = vi.fn();

    const resources: CleanupResources = {
      producer: mockProducer,
      pool: mockPool,
    };

    // Act
    await gracefulShutdown(resources, mockExitFn);

    // Assert
    expect(mockExitFn).toHaveBeenCalledWith(1);
  });

  it('should exit with code 1 when pool end fails', async () => {
    // Arrange
    const mockProducer = {
      disconnect: vi.fn().mockResolvedValue(undefined),
    } as unknown as Producer;

    const mockPool = {
      end: vi.fn().mockRejectedValue(new Error('Pool close failed')),
    } as unknown as Pool;

    const mockExitFn: ProcessExitFn = vi.fn();

    const resources: CleanupResources = {
      producer: mockProducer,
      pool: mockPool,
    };

    // Act
    await gracefulShutdown(resources, mockExitFn);

    // Assert
    expect(mockExitFn).toHaveBeenCalledWith(1);
  });

  it('should handle both producer and pool being null', async () => {
    // Arrange
    const mockExitFn: ProcessExitFn = vi.fn();

    const resources: CleanupResources = {
      producer: null,
      pool: null,
    };

    // Act
    await gracefulShutdown(resources, mockExitFn);

    // Assert
    expect(mockExitFn).toHaveBeenCalledWith(0);
  });
});

/**
 * Test Suite: main
 */
describe('main', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should initialize database, Kafka, and start Express server', async () => {
    // Arrange
    const mockInitDb = vi.fn().mockResolvedValue({});
    const mockInitKafka = vi.fn().mockResolvedValue({});
    const mockApp = {
      listen: vi.fn((port, callback) => {
        callback();
        return {} as any;
      }),
    };
    const mockCreateApp = vi.fn().mockReturnValue(mockApp);
    const mockExitFn = vi.fn();

    const deps: MainDependencies = {
      initDb: mockInitDb,
      initKafka: mockInitKafka,
      createApp: mockCreateApp,
      exitFn: mockExitFn,
      port: 3001,
    };

    // Act
    await main(deps);

    // Assert
    expect(mockInitDb).toHaveBeenCalled();
    expect(mockInitKafka).toHaveBeenCalled();
    expect(mockCreateApp).toHaveBeenCalled();
    expect(mockApp.listen).toHaveBeenCalledWith(
      3001,
      expect.any(Function)
    );
    expect(mockExitFn).not.toHaveBeenCalled();
  });

  it('should use default port from environment when not specified', async () => {
    // Arrange
    const originalPort = process.env.PORT;
    process.env.PORT = '8080';

    const mockInitDb = vi.fn().mockResolvedValue({});
    const mockInitKafka = vi.fn().mockResolvedValue({});
    const mockApp = {
      listen: vi.fn((port, callback) => {
        callback();
        return {} as any;
      }),
    };
    const mockCreateApp = vi.fn().mockReturnValue(mockApp);
    const mockExitFn = vi.fn();

    const deps: MainDependencies = {
      initDb: mockInitDb,
      initKafka: mockInitKafka,
      createApp: mockCreateApp,
      exitFn: mockExitFn,
    };

    // Act
    await main(deps);

    // Assert
    expect(mockApp.listen).toHaveBeenCalledWith(
      8080,
      expect.any(Function)
    );

    // Cleanup
    process.env.PORT = originalPort;
  });

  it('should exit with code 1 when database initialization fails', async () => {
    // Arrange
    const mockInitDb = vi.fn().mockRejectedValue(new Error('DB init failed'));
    const mockInitKafka = vi.fn().mockResolvedValue({});
    const mockCreateApp = vi.fn();
    const mockExitFn = vi.fn();

    const deps: MainDependencies = {
      initDb: mockInitDb,
      initKafka: mockInitKafka,
      createApp: mockCreateApp,
      exitFn: mockExitFn,
    };

    // Act
    await main(deps);

    // Assert
    expect(mockExitFn).toHaveBeenCalledWith(1);
    expect(mockInitKafka).not.toHaveBeenCalled();
    expect(mockCreateApp).not.toHaveBeenCalled();
  });

  it('should exit with code 1 when Kafka initialization fails', async () => {
    // Arrange
    const mockInitDb = vi.fn().mockResolvedValue({});
    const mockInitKafka = vi.fn().mockRejectedValue(new Error('Kafka init failed'));
    const mockCreateApp = vi.fn();
    const mockExitFn = vi.fn();

    const deps: MainDependencies = {
      initDb: mockInitDb,
      initKafka: mockInitKafka,
      createApp: mockCreateApp,
      exitFn: mockExitFn,
    };

    // Act
    await main(deps);

    // Assert
    expect(mockExitFn).toHaveBeenCalledWith(1);
    expect(mockInitDb).toHaveBeenCalled();
    expect(mockCreateApp).not.toHaveBeenCalled();
  });

  it('should register graceful shutdown handlers', async () => {
    // Arrange
    const mockInitDb = vi.fn().mockResolvedValue({});
    const mockInitKafka = vi.fn().mockResolvedValue({});
    const mockApp = {
      listen: vi.fn((port, callback) => {
        callback();
        return {} as any;
      }),
    };
    const mockCreateApp = vi.fn().mockReturnValue(mockApp);
    const mockOnShutdown = vi.fn();
    const mockExitFn = vi.fn();

    // Mock process.on
    const originalProcessOn = process.on;
    const processOnMock = vi.fn();
    process.on = processOnMock as any;

    const deps: MainDependencies = {
      initDb: mockInitDb,
      initKafka: mockInitKafka,
      createApp: mockCreateApp,
      onShutdown: mockOnShutdown,
      exitFn: mockExitFn,
      port: 3000,
    };

    // Act
    await main(deps);

    // Assert
    expect(processOnMock).toHaveBeenCalledWith('SIGTERM', mockOnShutdown);
    expect(processOnMock).toHaveBeenCalledWith('SIGINT', mockOnShutdown);

    // Cleanup
    process.on = originalProcessOn;
  });
});
