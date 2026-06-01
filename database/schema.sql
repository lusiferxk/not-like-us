-- =============================================================
--  NOT-LIKE-US — DATABASE SCHEMA
--  PostgreSQL 14+
--  Run: psql -U <user> -d <database> -f schema.sql
-- =============================================================

-- ─── Extensions ───────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "pgcrypto";  -- gen_random_uuid()

-- ─── ENUM TYPES ───────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE order_status      AS ENUM ('Pending', 'Paid', 'Shipped', 'Delivered', 'Cancelled', 'Expired');
  CREATE TYPE payment_status    AS ENUM ('Awaiting', 'Paid', 'Failed', 'Refunded');
  CREATE TYPE product_visibility AS ENUM ('active', 'hidden', 'out_of_stock');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =============================================================
--  TABLE: admin_users
-- =============================================================
CREATE TABLE IF NOT EXISTS admin_users (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  username     VARCHAR(60)  NOT NULL UNIQUE,
  password_hash TEXT        NOT NULL,          -- bcrypt hash
  email        VARCHAR(120) NOT NULL UNIQUE,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- =============================================================
--  TABLE: products
-- =============================================================
CREATE TABLE IF NOT EXISTS products (
  id            UUID              PRIMARY KEY DEFAULT gen_random_uuid(),
  name          VARCHAR(200)      NOT NULL,
  slug          VARCHAR(220)      NOT NULL UNIQUE,
  description   TEXT,
  price         NUMERIC(12, 2)    NOT NULL CHECK (price >= 0),
  stock         INTEGER           NOT NULL DEFAULT 0 CHECK (stock >= 0),
  category      VARCHAR(100),
  image_url     TEXT,
  visibility    product_visibility NOT NULL DEFAULT 'active',
  created_at    TIMESTAMPTZ       NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ       NOT NULL DEFAULT NOW()
);

-- Indexes for frequent product queries
CREATE INDEX IF NOT EXISTS idx_products_visibility       ON products (visibility);
CREATE INDEX IF NOT EXISTS idx_products_category         ON products (category);
CREATE INDEX IF NOT EXISTS idx_products_slug             ON products (slug);
CREATE INDEX IF NOT EXISTS idx_products_created_at       ON products (created_at DESC);

-- =============================================================
--  TABLE: orders
-- =============================================================
CREATE TABLE IF NOT EXISTS orders (
  id               UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  tracking_id      VARCHAR(64)    NOT NULL UNIQUE,  -- public-facing UUID
  customer_name    VARCHAR(120)   NOT NULL,
  customer_email   VARCHAR(120)   NOT NULL,
  customer_phone   VARCHAR(30),
  shipping_address TEXT           NOT NULL,
  city             VARCHAR(80),
  country          VARCHAR(60)    NOT NULL DEFAULT 'LK',
  total_amount     NUMERIC(12, 2) NOT NULL CHECK (total_amount >= 0),
  currency         VARCHAR(6)     NOT NULL DEFAULT 'LKR',
  status           order_status   NOT NULL DEFAULT 'Pending',
  payment_status   payment_status NOT NULL DEFAULT 'Awaiting',
  payhere_order_id VARCHAR(80),               -- PayHere's internal reference
  payhere_payment_id VARCHAR(80),             -- PayHere payment ID after success
  sqs_message_id   VARCHAR(120),              -- traceability back to SQS
  notes            TEXT,
  created_at       TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

-- Core query indexes
CREATE INDEX IF NOT EXISTS idx_orders_tracking_id      ON orders (tracking_id);
CREATE INDEX IF NOT EXISTS idx_orders_status           ON orders (status);
CREATE INDEX IF NOT EXISTS idx_orders_payment_status   ON orders (payment_status);
CREATE INDEX IF NOT EXISTS idx_orders_customer_email   ON orders (customer_email);
CREATE INDEX IF NOT EXISTS idx_orders_created_at       ON orders (created_at DESC);
-- Composite: admin dashboard filter + sort
CREATE INDEX IF NOT EXISTS idx_orders_status_created   ON orders (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_payment_created  ON orders (payment_status, created_at DESC);
-- EventBridge cron: find pending orders older than N hours
CREATE INDEX IF NOT EXISTS idx_orders_pending_created  ON orders (created_at) WHERE status = 'Pending';

-- =============================================================
--  TABLE: order_items
-- =============================================================
CREATE TABLE IF NOT EXISTS order_items (
  id           UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id     UUID           NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id   UUID           NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  product_name VARCHAR(200)   NOT NULL,   -- snapshot at time of order
  unit_price   NUMERIC(12, 2) NOT NULL,   -- snapshot at time of order
  quantity     INTEGER        NOT NULL CHECK (quantity > 0),
  line_total   NUMERIC(12, 2) GENERATED ALWAYS AS (unit_price * quantity) STORED
);

-- Indexes for order_items joins
CREATE INDEX IF NOT EXISTS idx_order_items_order_id    ON order_items (order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_product_id  ON order_items (product_id);
-- Composite for order detail page
CREATE INDEX IF NOT EXISTS idx_order_items_order_product ON order_items (order_id, product_id);

-- =============================================================
--  FUNCTION: auto-update updated_at on row changes
-- =============================================================
CREATE OR REPLACE FUNCTION trigger_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Attach trigger to all tables with updated_at
DO $$ BEGIN
  CREATE TRIGGER set_updated_at_products
    BEFORE UPDATE ON products
    FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TRIGGER set_updated_at_orders
    BEFORE UPDATE ON orders
    FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TRIGGER set_updated_at_admin_users
    BEFORE UPDATE ON admin_users
    FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =============================================================
--  SEED: Default admin user (password must be updated via API)
--  password_hash is bcrypt('changeme_immediately')
-- =============================================================
INSERT INTO admin_users (username, email, password_hash)
VALUES (
  'superadmin',
  'admin@example.com',
  '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewdBdXIG3WLfE5UK'
)
ON CONFLICT (username) DO NOTHING;
