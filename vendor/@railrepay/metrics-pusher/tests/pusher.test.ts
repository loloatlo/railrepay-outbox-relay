import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MetricsPusher, MetricsConfig, getRegistry, resetRegistry, Counter } from '../src';

// Mock prometheus-remote-write
vi.mock('prometheus-remote-write', () => ({
  pushMetrics: vi.fn().mockResolvedValue(undefined),
}));

describe('@railrepay/metrics-pusher', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv, NODE_ENV: 'test' };
    resetRegistry();
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.useRealTimers();
  });

  describe('MetricsPusher constructor', () => {
    it('should create pusher with required config', () => {
      const pusher = new MetricsPusher({
        serviceName: 'test-service',
      });
      expect(pusher).toBeDefined();
    });

    it('should throw error when serviceName is not provided', () => {
      expect(() =>
        new MetricsPusher({} as MetricsConfig)
      ).toThrow('MetricsConfig.serviceName is required');
    });

    it('should accept custom configuration', () => {
      const pusher = new MetricsPusher({
        serviceName: 'test-service',
        alloyUrl: 'http://alloy:9091/api/v1/metrics/write',
        pushInterval: 30,
        environment: 'production',
      });
      expect(pusher).toBeDefined();
    });

    it('should accept custom logger', () => {
      const customLogger = {
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
      };

      const pusher = new MetricsPusher({
        serviceName: 'test-service',
        logger: customLogger,
      });
      expect(pusher).toBeDefined();
    });
  });

  describe('MetricsPusher.start', () => {
    it('should not start without alloyUrl', async () => {
      const customLogger = {
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
      };

      const pusher = new MetricsPusher({
        serviceName: 'test-service',
        logger: customLogger,
      });

      await pusher.start();

      expect(customLogger.warn).toHaveBeenCalledWith(
        'Alloy URL not configured - metrics push disabled',
        expect.any(Object)
      );
      expect(pusher.isActive()).toBe(false);
    });

    it('should start with valid alloyUrl', async () => {
      const customLogger = {
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
      };

      const pusher = new MetricsPusher({
        serviceName: 'test-service',
        alloyUrl: 'http://alloy:9091/api/v1/metrics/write',
        logger: customLogger,
      });

      await pusher.start();

      expect(pusher.isActive()).toBe(true);
      expect(customLogger.info).toHaveBeenCalledWith(
        'Metrics pusher started successfully',
        expect.any(Object)
      );

      pusher.stop();
    });

    it('should not start twice', async () => {
      const customLogger = {
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
      };

      const pusher = new MetricsPusher({
        serviceName: 'test-service',
        alloyUrl: 'http://alloy:9091/api/v1/metrics/write',
        logger: customLogger,
      });

      await pusher.start();
      await pusher.start();

      expect(customLogger.warn).toHaveBeenCalledWith(
        'Metrics pusher already running',
        expect.any(Object)
      );

      pusher.stop();
    });
  });

  describe('MetricsPusher.stop', () => {
    it('should stop successfully', async () => {
      const customLogger = {
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
      };

      const pusher = new MetricsPusher({
        serviceName: 'test-service',
        alloyUrl: 'http://alloy:9091/api/v1/metrics/write',
        logger: customLogger,
      });

      await pusher.start();
      expect(pusher.isActive()).toBe(true);

      pusher.stop();
      expect(pusher.isActive()).toBe(false);
      expect(customLogger.info).toHaveBeenCalledWith(
        'Metrics pusher stopped',
        expect.any(Object)
      );
    });

    it('should handle stop when not running', () => {
      const pusher = new MetricsPusher({
        serviceName: 'test-service',
      });

      expect(() => pusher.stop()).not.toThrow();
    });
  });

  describe('MetricsPusher.pushMetrics', () => {
    it('should not push without alloyUrl', async () => {
      const pushMetricsMock = (await import('prometheus-remote-write')).pushMetrics;

      const pusher = new MetricsPusher({
        serviceName: 'test-service',
      });

      await pusher.pushMetrics();

      expect(pushMetricsMock).not.toHaveBeenCalled();
    });

    it('should push metrics with correct labels', async () => {
      const pushMetricsMock = (await import('prometheus-remote-write')).pushMetrics;

      // Add a metric to the registry
      const registry = getRegistry();
      const counter = new Counter({
        name: 'test_counter',
        help: 'Test counter',
        registers: [registry],
      });
      counter.inc();

      const pusher = new MetricsPusher({
        serviceName: 'test-service',
        alloyUrl: 'http://alloy:9091/api/v1/metrics/write',
        environment: 'test',
      });

      await pusher.pushMetrics();

      expect(pushMetricsMock).toHaveBeenCalledWith(
        expect.objectContaining({ test_counter: 1 }),
        expect.objectContaining({
          url: 'http://alloy:9091/api/v1/metrics/write',
          labels: {
            service: 'test-service',
            environment: 'test',
          },
        })
      );
    });
  });

  describe('getRegistry', () => {
    it('should return the same registry instance', () => {
      const registry1 = getRegistry();
      const registry2 = getRegistry();
      expect(registry1).toBe(registry2);
    });

    it('should return new registry after reset', () => {
      const registry1 = getRegistry();
      resetRegistry();
      const registry2 = getRegistry();
      expect(registry1).not.toBe(registry2);
    });
  });

  describe('metrics parsing', () => {
    it('should parse prometheus text format', async () => {
      const pushMetricsMock = (await import('prometheus-remote-write')).pushMetrics;

      const registry = getRegistry();
      const counter = new Counter({
        name: 'requests_total',
        help: 'Total requests',
        registers: [registry],
      });
      counter.inc(42);

      const pusher = new MetricsPusher({
        serviceName: 'test-service',
        alloyUrl: 'http://alloy:9091/api/v1/metrics/write',
      });

      await pusher.pushMetrics();

      expect(pushMetricsMock).toHaveBeenCalledWith(
        expect.objectContaining({ requests_total: 42 }),
        expect.any(Object)
      );
    });
  });
});
