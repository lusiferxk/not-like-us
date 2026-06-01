# Not-Like-Us — Production E-Commerce Backend

> High-traffic, fully asynchronous Node.js + Express backend with AWS SQS message buffering and EventBridge scheduled cron jobs.

## Architecture Overview

```
Client (SPA)
    │
    ▼
Express API (fast-path)
    ├── POST /api/v1/orders          → SQS: order-processing-queue
    └── POST /api/v1/payments/notify → SQS: payment-success-queue
                                          │
                       ┌──────────────────┼──────────────────┐
                       ▼                  ▼                  ▼
              Order Worker        Payment Worker        Email Worker
              (inserts DB)    (atomic txn + stock)   (SMTP or SES)
                                          │
                                          ▼
                                SQS: email-notification-queue

AWS EventBridge Scheduler (every 2h)
    └── expireOrders.js → mark stale Pending orders as Expired
```

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env
# Fill in all values in .env

# 3. Initialize database
psql -U <user> -d <database> -f database/schema.sql

# 4. Start the API server
npm run dev

# 5. Start worker daemons (separate terminals or PM2 processes)
npm run worker:orders
npm run worker:payments
npm run worker:emails
```

## API Reference

### Public Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/v1/orders` | Submit guest order → returns 202 + Tracking ID |
| `POST` | `/api/v1/payments/notify` | PayHere IPG webhook receiver |
| `GET`  | `/api/v1/health` | Health check |

#### POST /api/v1/orders — Request Body
```json
{
  "customerName": "John Doe",
  "customerEmail": "john@example.com",
  "customerPhone": "+94771234567",
  "shippingAddress": "123 Main Street",
  "city": "Colombo",
  "country": "LK",
  "currency": "LKR",
  "items": [
    {
      "productId": "uuid-here",
      "productName": "Product A",
      "unitPrice": 1500.00,
      "quantity": 2
    }
  ],
  "notes": "Leave at door"
}
```

### Admin Endpoints (Bearer token required)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/admin/products` | List products (paginated) |
| `POST` | `/api/v1/admin/products` | Create product |
| `PUT` | `/api/v1/admin/products/:id` | Update product |
| `DELETE` | `/api/v1/admin/products/:id` | Delete product |
| `GET` | `/api/v1/admin/orders` | List orders (paginated + filterable) |
| `GET` | `/api/v1/admin/orders/:id` | Order detail with line items |
| `GET` | `/api/v1/admin/orders/export?format=xlsx` | Download Excel/CSV export |
| `PUT` | `/api/v1/admin/orders/:id/status` | Override order status |

#### Admin Auth Header
```
Authorization: Bearer <ADMIN_SECRET>
```

## SQS Queue Architecture

| Queue | Producer | Consumer | Purpose |
|-------|----------|----------|---------|
| `order-processing-queue` | `/api/v1/orders` | `orderWorker.js` | DB persistence + PayHere params |
| `payment-success-queue` | `/api/v1/payments/notify` | `paymentWorker.js` | Atomic payment + inventory |
| `email-notification-queue` | `paymentWorker.js` | `emailWorker.js` | SMTP/SES receipt dispatch |

## PayHere Integration

The system implements the official PayHere MD5 double-hash signature:

```
secretHash = MD5(MERCHANT_SECRET).toUpperCase()
signature  = MD5(merchant_id + order_id + amount + currency + status_code + secretHash).toUpperCase()
```

Set `PAYHERE_ENV=sandbox` for testing. Switch to `production` for live payments.

## EventBridge Cron Configuration

Deploy `cron/expireOrders.js` as an AWS Lambda function, then register the schedule:

```bash
aws scheduler create-schedule \
  --name expire-pending-orders \
  --schedule-expression "rate(2 hours)" \
  --target '{"Arn":"<LAMBDA_ARN>","RoleArn":"<SCHEDULER_ROLE_ARN>","Input":"{}"}' \
  --flexible-time-window '{"Mode":"OFF"}'
```

## Production Deployment (PM2)

```bash
npm install -g pm2

pm2 start src/server.js       --name api-server
pm2 start workers/orderWorker.js   --name worker-orders
pm2 start workers/paymentWorker.js --name worker-payments
pm2 start workers/emailWorker.js   --name worker-emails

pm2 save
pm2 startup
```

## Project Structure

```
not-like-us/
├── src/
│   ├── server.js              # Express entry point + graceful shutdown
│   ├── router.js              # Unified route registry
│   ├── config/
│   │   ├── db.js              # pg Pool (max 20 connections)
│   │   ├── sqs.js             # SQSClient singleton
│   │   └── eventbridge.js     # SchedulerClient singleton
│   ├── middleware/
│   │   ├── auth.js            # Bearer token guard (constant-time compare)
│   │   ├── errorHandler.js    # 404 + global error boundary
│   │   └── validate.js        # Zod middleware factory
│   ├── validators/
│   │   ├── orderSchema.js     # Order + cart Zod schema
│   │   └── paymentSchema.js   # PayHere webhook Zod schema
│   ├── routes/
│   │   ├── orders.js          # POST /api/v1/orders
│   │   ├── payments.js        # POST /api/v1/payments/notify
│   │   └── admin/
│   │       ├── products.js    # CRUD /api/v1/admin/products
│   │       └── orders.js      # List + export /api/v1/admin/orders
│   ├── services/
│   │   ├── payhere.js         # MD5 sig generation + verification
│   │   ├── sqsPublisher.js    # Typed SQS send wrappers
│   │   └── excelExporter.js   # ExcelJS streaming export + CSV fallback
│   └── utils/
│       ├── logger.js          # Winston JSON logger
│       └── helpers.js         # UUID, MD5, formatAmount, secureCompare
├── workers/
│   ├── orderWorker.js         # Daemon: order-processing-queue
│   ├── paymentWorker.js       # Daemon: payment-success-queue (atomic txn)
│   └── emailWorker.js         # Daemon: email-notification-queue
├── cron/
│   └── expireOrders.js        # EventBridge Lambda target + CLI runner
├── database/
│   └── schema.sql             # Full DDL + indexes + triggers
├── .env.example
├── package.json
└── README.md
```
