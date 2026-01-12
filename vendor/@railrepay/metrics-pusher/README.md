# @railrepay/metrics-pusher

Prometheus metrics collection and push-based observability for RailRepay microservices.

## Features

- Push metrics to Grafana Alloy using remote_write protocol
- Express router for /metrics endpoint (pull-based scraping)
- Shared Prometheus registry for metric registration
- Configurable push intervals
- Re-exports prom-client types for convenience

## Installation

```bash
npm install @railrepay/metrics-pusher
```

## Usage

### Basic Push-Based Setup

```typescript
import { MetricsPusher, getRegistry, Counter } from '@railrepay/metrics-pusher';

// Register custom metrics
const registry = getRegistry();
const requestsCounter = new Counter({
  name: 'http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['method', 'status'],
  registers: [registry],
});

// Create and start the pusher
const pusher = new MetricsPusher({
  serviceName: 'my-service',           // REQUIRED
  alloyUrl: 'http://alloy:9091/api/v1/metrics/write',
  pushInterval: 15,                    // seconds
});

await pusher.start();

// Increment metrics
requestsCounter.inc({ method: 'GET', status: '200' });

// Graceful shutdown
pusher.stop();
```

### Pull-Based Setup (Express)

```typescript
import express from 'express';
import { createMetricsRouter, getRegistry, Counter } from '@railrepay/metrics-pusher';

const app = express();

// Register custom metrics
const registry = getRegistry();
const requestsCounter = new Counter({
  name: 'http_requests_total',
  help: 'Total HTTP requests',
  registers: [registry],
});

// Mount metrics endpoint at /metrics
app.use('/metrics', createMetricsRouter());

app.listen(3000);
```

### Hybrid Setup (Both Push and Pull)

```typescript
import express from 'express';
import { MetricsPusher, createMetricsRouter, getRegistry, Counter } from '@railrepay/metrics-pusher';

const app = express();

// Register metrics
const registry = getRegistry();
const counter = new Counter({
  name: 'events_processed_total',
  help: 'Total events processed',
  registers: [registry],
});

// Pull-based: /metrics endpoint
app.use('/metrics', createMetricsRouter());

// Push-based: to Grafana Alloy
const pusher = new MetricsPusher({
  serviceName: 'my-service',
  alloyUrl: process.env.ALLOY_PUSH_URL,
});
await pusher.start();

// Use in application
counter.inc();

app.listen(3000);
```

### Manual One-Shot Push

```typescript
const pusher = new MetricsPusher({
  serviceName: 'batch-job',
  alloyUrl: process.env.ALLOY_PUSH_URL,
});

// Push once (useful for batch jobs/cron)
await pusher.pushMetrics();
```

## Configuration

### MetricsConfig Interface

| Property | Type | Required | Default | Description |
|----------|------|----------|---------|-------------|
| `serviceName` | `string` | Yes | - | Service name for labels |
| `alloyUrl` | `string` | No | `process.env.ALLOY_PUSH_URL` | Alloy remote_write endpoint |
| `pushInterval` | `number` | No | `15` | Push interval in seconds |
| `environment` | `string` | No | `process.env.NODE_ENV` | Environment for labels |
| `logger` | `Logger` | No | `console` | Logger instance |

### Environment Variables

- `ALLOY_PUSH_URL` - Alloy remote_write endpoint (e.g., `http://grafana-alloy:9091/api/v1/metrics/write`)
- `NODE_ENV` - Environment name for labels

## Metric Types

Re-exported from prom-client for convenience:

```typescript
import { Counter, Histogram, Gauge, Summary, Registry } from '@railrepay/metrics-pusher';

const counter = new Counter({
  name: 'events_total',
  help: 'Total events',
  registers: [getRegistry()],
});

const histogram = new Histogram({
  name: 'request_duration_seconds',
  help: 'Request duration',
  buckets: [0.01, 0.1, 0.5, 1, 5],
  registers: [getRegistry()],
});

const gauge = new Gauge({
  name: 'queue_depth',
  help: 'Current queue depth',
  registers: [getRegistry()],
});
```

## Architecture

```
┌─────────────────┐     Push      ┌───────────────┐     Forward    ┌───────────────┐
│   Microservice  │ ────────────► │ Grafana Alloy │ ─────────────► │ Grafana Cloud │
│  (this package) │               │   (Gateway)   │                │  (Prometheus) │
└─────────────────┘               └───────────────┘                └───────────────┘
        │
        │ Pull (optional)
        ▼
┌─────────────────┐
│   /metrics      │
│   endpoint      │
└─────────────────┘
```

## License

Private - RailRepay
