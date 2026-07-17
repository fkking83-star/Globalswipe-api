import prometheus from 'prom-client';

export const register = new prometheus.Registry();
prometheus.collectDefaultMetrics({ register });

export const orderCounter = new prometheus.Counter({
  name: 'globalswipe_orders_total',
  help: 'Total number of orders created',
  labelNames: ['status', 'payment_method'],
  registers: [register],
});

export const orderAmount = new prometheus.Histogram({
  name: 'globalswipe_order_amount_dkk',
  help: 'Order amount in DKK',
  buckets: [100, 500, 1000, 5000, 10000, 50000],
  registers: [register],
});

export const ledgerTxCounter = new prometheus.Counter({
  name: 'globalswipe_ledger_transactions_total',
  help: 'Total number of ledger transactions',
  labelNames: ['kind'],
  registers: [register],
});

export const apiLatency = new prometheus.Histogram({
  name: 'globalswipe_api_latency_seconds',
  help: 'API request latency',
  labelNames: ['endpoint', 'method'],
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5],
  registers: [register],
});
