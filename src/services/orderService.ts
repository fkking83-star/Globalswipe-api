import pool from '../config/database';
import { PriceResponse, OrderResponse } from '../types';

export class OrderService {
  async calculatePrice(
    sendAmountDkk: number,
    corridorId: string,
    paymentMethodId: string
  ): Promise<PriceResponse> {
    const result = await pool.query(
      `SELECT * FROM calculate_transfer_price($1, $2, $3)`,
      [sendAmountDkk, corridorId, paymentMethodId]
    );

    if (!result.rows[0]) {
      throw new Error('No rate found for corridor');
    }

    const row = result.rows[0];
    return {
      sendAmountDkk: parseFloat(row.send_amount_dkk),
      receiveAmountUsd: parseFloat(row.receive_amount_usd),
      exchangeRate: parseFloat(row.exchange_rate),
      flatFeeDkk: parseFloat(row.flat_fee_dkk),
      surchargeDkk: parseFloat(row.surcharge_dkk),
      totalDkkCharged: parseFloat(row.total_dkk_charged),
    };
  }

  async createOrder(
    sendAmountDkk: number,
    corridorId: string,
    paymentMethodId: string,
    customerId: string
  ): Promise<OrderResponse> {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const result = await client.query(
        `WITH price AS (
           SELECT * FROM calculate_transfer_price($1, $2, $3)
         )
         INSERT INTO transfer_orders (
           customer_id, corridor_id, payment_method_id,
           send_amount_dkk, receive_amount_usd, exchange_rate_used,
           flat_fee_dkk, surcharge_dkk, total_dkk_charged
         )
         SELECT $4, $2, $3,
                send_amount_dkk, receive_amount_usd, exchange_rate,
                flat_fee_dkk, surcharge_dkk, total_dkk_charged
         FROM price
         RETURNING id`,
        [sendAmountDkk, corridorId, paymentMethodId, customerId]
      );

      if (!result.rows[0]) {
        throw new Error('Failed to create order – price calculation returned no result');
      }

      const orderId = result.rows[0].id;
      await client.query('COMMIT');
      return this.getOrder(orderId);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async getOrder(orderId: string): Promise<OrderResponse> {
    const result = await pool.query(
      `SELECT
        o.id,
        o.customer_id AS "customerId",
        o.corridor_id AS "corridorId",
        o.payment_method_id AS "paymentMethodId",
        pm.method_code AS "paymentMethod",
        o.send_amount_dkk AS "sendAmountDkk",
        o.receive_amount_usd AS "receiveAmountUsd",
        o.exchange_rate_used AS "exchangeRateUsed",
        o.flat_fee_dkk AS "flatFeeDkk",
        o.surcharge_dkk AS "surchargeDkk",
        o.total_dkk_charged AS "totalDkkCharged",
        o.status,
        o.transaction_id AS "transactionId",
        o.created_at AS "createdAt",
        o.updated_at AS "updatedAt",
        CASE
          WHEN o.status = 'SETTLED' THEN
            JSONB_BUILD_OBJECT(
              'fundingTxId', o.metadata->>'funding_tx_id',
              'fxTxId',      o.metadata->>'fx_tx_id',
              'payoutTxId',  o.metadata->>'payout_tx_id'
            )
          ELSE NULL
        END AS ledger
      FROM transfer_orders o
      LEFT JOIN payment_methods pm ON pm.id = o.payment_method_id
      WHERE o.id = $1`,
      [orderId]
    );

    if (result.rows.length === 0) {
      throw new Error('Order not found');
    }

    const row = result.rows[0];
    return {
      id: row.id,
      customerId: row.customerId,
      corridorId: row.corridorId,
      paymentMethodId: row.paymentMethodId,
      paymentMethod: row.paymentMethod,
      sendAmountDkk: parseFloat(row.sendAmountDkk),
      receiveAmountUsd: row.receiveAmountUsd ? parseFloat(row.receiveAmountUsd) : 0,
      exchangeRateUsed: parseFloat(row.exchangeRateUsed),
      flatFeeDkk: parseFloat(row.flatFeeDkk),
      surchargeDkk: parseFloat(row.surchargeDkk),
      totalDkkCharged: parseFloat(row.totalDkkCharged),
      status: row.status,
      transactionId: row.transactionId,
      ledger: row.ledger,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async bookOrder(
    orderId: string
  ): Promise<{ status: string; steps: Array<{ step: string; txId: string }> }> {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const result = await client.query(
        `SELECT * FROM create_ledger_from_order($1)`,
        [orderId]
      );

      await client.query('COMMIT');

      const steps = result.rows.map((row: { step: string; tx_id: string }) => ({
        step: row.step,
        txId: row.tx_id,
      }));

      return {
        status: 'SETTLED',
        steps,
      };
    } catch (error: unknown) {
      await client.query('ROLLBACK');

      const err = error as { code?: string; message?: string };
      if (err.code === 'P0001') {
        const message = err.message || '';
        if (message.includes('not pending')) {
          throw new Error('Order not found or already booked');
        }
        if (message.includes('mismatch')) {
          throw new Error(message);
        }
        if (message.includes('not found')) {
          throw new Error('Ledger account not found – run 002 seed');
        }
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async getBalanceDelta(
    orderId: string
  ): Promise<Array<{ code: string; currency: string; deltaMajor: number }>> {
    const result = await pool.query(
      `SELECT * FROM get_order_balance_delta($1)`,
      [orderId]
    );

    return result.rows.map((row: { code: string; currency: string; delta_major: string }) => ({
      code: row.code,
      currency: row.currency,
      deltaMajor: parseFloat(row.delta_major),
    }));
  }
}
