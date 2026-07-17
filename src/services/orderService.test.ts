import { OrderService } from './orderService';

jest.mock('../config/database', () => ({
  __esModule: true,
  default: {
    query: jest.fn(),
    connect: jest.fn().mockResolvedValue({
      query: jest.fn(),
      release: jest.fn(),
    }),
  },
}));

describe('OrderService', () => {
  let service: OrderService;

  beforeEach(() => {
    service = new OrderService();
    jest.clearAllMocks();
  });

  it('should calculate price', async () => {
    const mockPool = require('../config/database').default;
    mockPool.query.mockResolvedValue({
      rows: [
        {
          send_amount_dkk: '1000.00',
          receive_amount_usd: '143.71',
          exchange_rate: '0.1437072',
          flat_fee_dkk: '9.00',
          surcharge_dkk: '0.00',
          total_dkk_charged: '1009.00',
        },
      ],
    });

    const result = await service.calculatePrice(1000, 'corridor-id', 'payment-id');
    expect(result.totalDkkCharged).toBe(1009.0);
    expect(result.receiveAmountUsd).toBe(143.71);
  });

  it('should throw on empty result', async () => {
    const mockPool = require('../config/database').default;
    mockPool.query.mockResolvedValue({ rows: [] });

    await expect(service.calculatePrice(1000, 'corridor-id', 'payment-id')).rejects.toThrow(
      'No rate found for corridor'
    );
  });
});
