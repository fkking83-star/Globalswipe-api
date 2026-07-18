import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import { OrderService } from './services/orderService';
import { PaymentMethodService } from './services/paymentMethodService';
import { PriceRequest, OrderRequest } from './types';
import pool from './config/database';
import { register, orderCounter, orderAmount, ledgerTxCounter, apiLatency } from './metrics';
import { apiKeyAuth } from './middleware/auth';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;
const orderService = new OrderService();
const paymentMethodService = new PaymentMethodService();

app.use(helmet());
app.use(cors());
app.use(express.json());

const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10),
  max: parseInt(process.env.RATE_LIMIT_MAX || '100', 10),
  message: { error: 'Too many requests, please try again later.' },
});
app.use('/api', limiter);
app.use('/api', apiKeyAuth);

const isValidUuid = (id: string): boolean => {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(id);
};

// 1. POST /api/price
app.post('/api/price', async (req, res) => {
  const startTime = Date.now();
  try {
    const { sendAmountDkk, corridorId, paymentMethodId } = req.body as PriceRequest;

    if (!sendAmountDkk || !corridorId || !paymentMethodId) {
      return res.status(400).json({
        error: 'Missing required fields: sendAmountDkk, corridorId, paymentMethodId',
      });
    }

    if (sendAmountDkk <= 0) {
      return res.status(400).json({ error: 'sendAmountDkk must be positive' });
    }

    if (!isValidUuid(corridorId) || !isValidUuid(paymentMethodId)) {
      return res.status(400).json({ error: 'Invalid UUID format' });
    }

    const result = await orderService.calculatePrice(sendAmountDkk, corridorId, paymentMethodId);
    apiLatency.observe({ endpoint: '/price', method: 'POST' }, (Date.now() - startTime) / 1000);
    res.json(result);
  } catch (error: unknown) {
    apiLatency.observe({ endpoint: '/price', method: 'POST' }, (Date.now() - startTime) / 1000);
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Price error:', error);
    if (message.includes('No rate found')) {
      res.status(404).json({ error: 'No rate found for corridor' });
    } else if (message.includes('No fee found')) {
      res.status(404).json({ error: 'No fee found for corridor and payment method' });
    } else {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

// 2. POST /api/orders
app.post('/api/orders', async (req, res) => {
  const startTime = Date.now();
  try {
    const { sendAmountDkk, corridorId, paymentMethodId, customerId } = req.body as OrderRequest;

    if (!sendAmountDkk || !corridorId || !paymentMethodId || !customerId) {
      return res.status(400).json({
        error: 'Missing required fields: sendAmountDkk, corridorId, paymentMethodId, customerId',
      });
    }

    if (sendAmountDkk <= 0) {
      return res.status(400).json({ error: 'sendAmountDkk must be positive' });
    }

    if (!isValidUuid(corridorId) || !isValidUuid(paymentMethodId) || !isValidUuid(customerId)) {
      return res.status(400).json({ error: 'Invalid UUID format' });
    }

    const result = await orderService.createOrder(
      sendAmountDkk,
      corridorId,
      paymentMethodId,
      customerId
    );

    orderCounter.inc({ status: result.status, payment_method: result.paymentMethod || 'unknown' });
    orderAmount.observe(result.sendAmountDkk);
    apiLatency.observe({ endpoint: '/orders', method: 'POST' }, (Date.now() - startTime) / 1000);
    res.status(201).json(result);
  } catch (error: unknown) {
    apiLatency.observe({ endpoint: '/orders', method: 'POST' }, (Date.now() - startTime) / 1000);
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Create order error:', error);
    if (message.includes('No rate found')) {
      res.status(404).json({ error: 'No rate found for corridor' });
    } else if (message.includes('No fee found')) {
      res.status(404).json({ error: 'No fee found for corridor and payment method' });
    } else {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

// 3. POST /api/orders/:id/book
app.post('/api/orders/:id/book', async (req, res) => {
  const startTime = Date.now();
  try {
    const { id } = req.params;

    if (!id || !isValidUuid(id)) {
      return res.status(400).json({ error: 'Invalid order ID format' });
    }

    const order = await orderService.getOrder(id);
    const result = await orderService.bookOrder(id);

    orderCounter.inc({
      status: 'SETTLED',
      payment_method: order.paymentMethod || 'unknown',
    });

    result.steps.forEach((step) => {
      ledgerTxCounter.inc({ kind: step.step });
    });

    apiLatency.observe({ endpoint: '/orders/book', method: 'POST' }, (Date.now() - startTime) / 1000);
    res.json(result);
  } catch (error: unknown) {
    apiLatency.observe({ endpoint: '/orders/book', method: 'POST' }, (Date.now() - startTime) / 1000);
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Book order error:', error);
    if (message.includes('Order not found or already booked')) {
      res.status(409).json({ error: 'Order not found or already booked' });
    } else if (message.includes('Order not found')) {
      res.status(404).json({ error: 'Order not found' });
    } else if (message.includes('mismatch')) {
      res.status(422).json({ error: message });
    } else if (message.includes('Ledger account not found')) {
      res.status(503).json({ error: 'Ledger account not found – run 002 seed' });
    } else {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

// 4. GET /api/orders/:id/balance-delta
app.get('/api/orders/:id/balance-delta', async (req, res) => {
  const startTime = Date.now();
  try {
    const { id } = req.params;

    if (!id || !isValidUuid(id)) {
      return res.status(400).json({ error: 'Invalid order ID format' });
    }

    const deltas = await orderService.getBalanceDelta(id);
    apiLatency.observe(
      { endpoint: '/orders/balance-delta', method: 'GET' },
      (Date.now() - startTime) / 1000
    );
    res.json({ deltas });
  } catch (error: unknown) {
    apiLatency.observe(
      { endpoint: '/orders/balance-delta', method: 'GET' },
      (Date.now() - startTime) / 1000
    );
    console.error('Balance delta error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 5. GET /api/orders/:id
app.get('/api/orders/:id', async (req, res) => {
  const startTime = Date.now();
  try {
    const { id } = req.params;

    if (!id || !isValidUuid(id)) {
      return res.status(400).json({ error: 'Invalid order ID format' });
    }

    const order = await orderService.getOrder(id);
    apiLatency.observe({ endpoint: '/orders', method: 'GET' }, (Date.now() - startTime) / 1000);
    res.json(order);
  } catch (error: unknown) {
    apiLatency.observe({ endpoint: '/orders', method: 'GET' }, (Date.now() - startTime) / 1000);
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Get order error:', error);
    if (message.includes('Order not found')) {
      res.status(404).json({ error: 'Order not found' });
    } else {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

// 6. GET /api/payment-methods
app.get('/api/payment-methods', async (req, res) => {
  const startTime = Date.now();
  try {
    const { corridorId } = req.query;

    let methods;
    if (corridorId) {
      if (!isValidUuid(corridorId as string)) {
        return res.status(400).json({ error: 'Invalid corridor ID format' });
      }
      methods = await paymentMethodService.getPaymentMethodsForCorridor(corridorId as string);
    } else {
      methods = await paymentMethodService.getAllPaymentMethods();
    }

    apiLatency.observe({ endpoint: '/payment-methods', method: 'GET' }, (Date.now() - startTime) / 1000);
    res.json({ methods });
  } catch (error: unknown) {
    apiLatency.observe({ endpoint: '/payment-methods', method: 'GET' }, (Date.now() - startTime) / 1000);
    console.error('Payment methods error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 7. GET /api/payment-methods/:id
app.get('/api/payment-methods/:id', async (req, res) => {
  const startTime = Date.now();
  try {
    const { id } = req.params;

    if (!id || !isValidUuid(id)) {
      return res.status(400).json({ error: 'Invalid payment method ID format' });
    }

    const method = await paymentMethodService.getPaymentMethodById(id);

    if (!method) {
      return res.status(404).json({ error: 'Payment method not found' });
    }

    apiLatency.observe({ endpoint: '/payment-methods/:id', method: 'GET' }, (Date.now() - startTime) / 1000);
    res.json(method);
  } catch (error: unknown) {
    apiLatency.observe({ endpoint: '/payment-methods/:id', method: 'GET' }, (Date.now() - startTime) / 1000);
    console.error('Payment method error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Public: metrics + health
app.get('/metrics', async (_req, res) => {
  try {
    res.set('Content-Type', register.contentType);
    res.send(await register.metrics());
  } catch {
    res.status(500).json({ error: 'Metrics unavailable' });
  }
});

app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({
      status: 'ok',
      version: '1.0.0',
      db: 'connected',
      timestamp: new Date().toISOString(),
    });
  } catch {
    res.status(503).json({
      status: 'error',
      version: '1.0.0',
      db: 'disconnected',
      timestamp: new Date().toISOString(),
    });
  }
});

app.listen(port, () => {
  console.log(`✅ GlobalSwipe API v1.0.0 running on port ${port}`);
  console.log(`   POST /api/price`);
  console.log(`   POST /api/orders`);
  console.log(`   POST /api/orders/:id/book`);
  console.log(`   GET  /api/orders/:id/balance-delta`);
  console.log(`   GET  /api/orders/:id`);
  console.log(`   GET  /api/payment-methods`);
  console.log(`   GET  /api/payment-methods/:id`);
  console.log(`   GET  /metrics`);
  console.log(`   GET  /health`);
});
