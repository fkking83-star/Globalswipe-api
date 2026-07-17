export interface PriceRequest {
  sendAmountDkk: number;
  corridorId: string;
  paymentMethodId: string;
}

export interface OrderRequest extends PriceRequest {
  customerId: string;
}

export interface PriceResponse {
  sendAmountDkk: number;
  receiveAmountUsd: number;
  exchangeRate: number;
  flatFeeDkk: number;
  surchargeDkk: number;
  totalDkkCharged: number;
}

export interface OrderResponse {
  id: string;
  customerId: string;
  corridorId: string;
  paymentMethodId: string;
  paymentMethod?: string;
  sendAmountDkk: number;
  receiveAmountUsd: number;
  exchangeRateUsed: number;
  flatFeeDkk: number;
  surchargeDkk: number;
  totalDkkCharged: number;
  status: 'PENDING' | 'AUTHORIZED' | 'SETTLED' | 'REVERSED' | 'FAILED';
  transactionId: string | null;
  ledger: {
    fundingTxId: string;
    fxTxId: string;
    payoutTxId: string;
  } | null;
  createdAt: string;
  updatedAt: string;
}

export interface BookResponse {
  status: 'SETTLED';
  steps: Array<{ step: string; txId: string }>;
}

export interface BalanceDeltaResponse {
  deltas: Array<{
    code: string;
    currency: string;
    deltaMajor: number;
  }>;
}
