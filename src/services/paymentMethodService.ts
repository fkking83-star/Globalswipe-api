import pool from '../config/database';
import { PaymentMethod } from '../types';

export class PaymentMethodService {
  async getAllPaymentMethods(): Promise<PaymentMethod[]> {
    const result = await pool.query(
      `SELECT
        id,
        method_code AS "methodCode",
        display_name AS "displayName",
        surcharge_percentage AS "surchargePercentage",
        is_active AS "isActive"
      FROM payment_methods
      WHERE is_active = TRUE
      ORDER BY method_code`
    );

    return result.rows.map((row) => ({
      id: row.id,
      methodCode: row.methodCode,
      displayName: row.displayName,
      surchargePercentage: parseFloat(row.surchargePercentage),
      isActive: row.isActive,
    }));
  }

  async getPaymentMethodById(id: string): Promise<PaymentMethod | null> {
    const result = await pool.query(
      `SELECT
        id,
        method_code AS "methodCode",
        display_name AS "displayName",
        surcharge_percentage AS "surchargePercentage",
        is_active AS "isActive"
      FROM payment_methods
      WHERE id = $1 AND is_active = TRUE`,
      [id]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    return {
      id: row.id,
      methodCode: row.methodCode,
      displayName: row.displayName,
      surchargePercentage: parseFloat(row.surchargePercentage),
      isActive: row.isActive,
    };
  }

  async getPaymentMethodsForCorridor(corridorId: string): Promise<PaymentMethod[]> {
    const result = await pool.query(
      `SELECT
        pm.id,
        pm.method_code AS "methodCode",
        pm.display_name AS "displayName",
        pm.surcharge_percentage AS "surchargePercentage",
        pm.is_active AS "isActive"
      FROM payment_methods pm
      JOIN fee_structures fs ON fs.payment_method_id = pm.id
      WHERE fs.corridor_id = $1
        AND pm.is_active = TRUE
        AND fs.is_active = TRUE
      ORDER BY pm.method_code`,
      [corridorId]
    );

    return result.rows.map((row) => ({
      id: row.id,
      methodCode: row.methodCode,
      displayName: row.displayName,
      surchargePercentage: parseFloat(row.surchargePercentage),
      isActive: row.isActive,
    }));
  }
}
