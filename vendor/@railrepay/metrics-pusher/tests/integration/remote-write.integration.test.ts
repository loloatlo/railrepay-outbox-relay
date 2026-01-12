/**
 * Integration test for MetricsPusher remote write functionality
 *
 * This test does NOT mock prometheus-remote-write to verify the full HTTP path,
 * including the node-fetch dependency that prometheus-remote-write requires.
 *
 * Purpose: Catch missing peer/runtime dependencies like node-fetch
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer, Server, IncomingMessage, ServerResponse } from 'http';
import { MetricsPusher, getRegistry, resetRegistry, Counter } from '../../src';

describe('@railrepay/metrics-pusher - Remote Write Integration', () => {
  let httpServer: Server;
  let serverPort: number;
  let receivedRequests: Array<{ body: string; headers: IncomingMessage['headers'] }> = [];

  beforeEach(async () => {
    resetRegistry();
    receivedRequests = [];

    // Create a real HTTP server to receive metrics
    httpServer = createServer((req: IncomingMessage, res: ServerResponse) => {
      let body = '';

      req.on('data', (chunk) => {
        body += chunk.toString();
      });

      req.on('end', () => {
        receivedRequests.push({
          body,
          headers: req.headers,
        });

        // Respond with 200 OK (simulating Alloy/Prometheus remote_write endpoint)
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'success' }));
      });
    });

    // Start server on random port
    await new Promise<void>((resolve) => {
      httpServer.listen(0, '127.0.0.1', () => {
        const address = httpServer.address();
        if (address && typeof address !== 'string') {
          serverPort = address.port;
        }
        resolve();
      });
    });
  });

  afterEach(async () => {
    if (httpServer) {
      await new Promise<void>((resolve, reject) => {
        httpServer.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    }
  });

  it('should successfully push metrics to remote endpoint using node-fetch', async () => {
    // Arrange: Register a test metric
    const registry = getRegistry();
    const counter = new Counter({
      name: 'integration_test_counter',
      help: 'Integration test counter',
      registers: [registry],
    });
    counter.inc(123);

    // Create pusher pointing to our local test server
    const alloyUrl = `http://127.0.0.1:${serverPort}/api/v1/push`;

    const customLogger = {
      info: () => {},
      error: () => {},
      warn: () => {},
      debug: () => {},
    };

    const pusher = new MetricsPusher({
      serviceName: 'integration-test-service',
      alloyUrl,
      environment: 'test',
      logger: customLogger,
    });

    // Act: Push metrics (this will use real prometheus-remote-write → node-fetch)
    await pusher.pushMetrics();

    // Assert: Verify that our HTTP server received the request
    expect(receivedRequests).toHaveLength(1);

    const request = receivedRequests[0];
    expect(request).toBeDefined();
    expect(request.headers['content-type']).toContain('application/x-protobuf');

    // Note: We don't verify the protobuf body content here (that's prometheus-remote-write's responsibility)
    // We only verify that the HTTP request was made successfully, which proves node-fetch is available
  }, 10000); // 10s timeout for HTTP operations

  it('should handle HTTP errors gracefully', async () => {
    // Arrange: Create pusher pointing to invalid URL
    const invalidUrl = `http://127.0.0.1:${serverPort + 1}/nonexistent`;

    const errorLogs: string[] = [];
    const customLogger = {
      info: () => {},
      error: (msg: string) => errorLogs.push(msg),
      warn: () => {},
      debug: () => {},
    };

    const registry = getRegistry();
    const counter = new Counter({
      name: 'error_test_counter',
      help: 'Error test counter',
      registers: [registry],
    });
    counter.inc(1);

    const pusher = new MetricsPusher({
      serviceName: 'error-test-service',
      alloyUrl: invalidUrl,
      logger: customLogger,
    });

    // Act: Push metrics (should fail but not throw)
    await pusher.pushMetrics();

    // Assert: Error should be logged, not thrown
    expect(errorLogs).toContain('Failed to push metrics');
  }, 10000);

  it('should not push when no metrics are registered', async () => {
    // Arrange: Empty registry
    resetRegistry();

    const warnLogs: string[] = [];
    const customLogger = {
      info: () => {},
      error: () => {},
      warn: (msg: string) => warnLogs.push(msg),
      debug: () => {},
    };

    const alloyUrl = `http://127.0.0.1:${serverPort}/api/v1/push`;

    const pusher = new MetricsPusher({
      serviceName: 'empty-test-service',
      alloyUrl,
      logger: customLogger,
    });

    // Act: Push metrics
    await pusher.pushMetrics();

    // Assert: No HTTP requests should be made
    expect(receivedRequests).toHaveLength(0);
    expect(warnLogs).toContain('No metrics to push');
  });
});
