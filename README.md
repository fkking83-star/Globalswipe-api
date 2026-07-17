# GlobalSwipe API v1.0.0

REST API for [GlobalSwipe v3.1](https://github.com/fkking83-star/globalswipe) ledger.

## Prerequisites

1. PostgreSQL with GlobalSwipe migrations applied (`001` → `002` → `003`)
2. Node.js 18+

## Setup

```bash
npm install
cp .env.example .env
# Edit .env with DB credentials
```

## Run

```bash
npm run dev      # development
npm run build && npm start   # production
```

## Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/price` | API key* | Quote transfer |
| POST | `/api/orders` | API key* | Create PENDING order |
| POST | `/api/orders/:id/book` | API key* | Book → SETTLED |
| GET | `/api/orders/:id/balance-delta` | API key* | Ledger deltas |
| GET | `/api/orders/:id` | API key* | Order details |
| GET | `/health` | Public | Health + DB ping |
| GET | `/metrics` | Public | Prometheus metrics |

\* API key required when `API_KEYS` is set in `.env` (`x-api-key` header).

## Tests

```bash
npm test
```
