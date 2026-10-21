-- Do not add BEGIN or COMMIT: the runner wraps each file in one transaction.

CREATE TABLE products (
  id text PRIMARY KEY,
  name text NOT NULL,
  category text NOT NULL,
  requires_cold_chain boolean NOT NULL
);

CREATE TABLE warehouses (
  id text PRIMARY KEY,
  city text NOT NULL,
  distance_km integer NOT NULL CHECK (distance_km > 0),
  has_cold_storage boolean NOT NULL,
  has_refrigerated_vehicle boolean NOT NULL
);

CREATE TABLE stock (
  warehouse_id text NOT NULL REFERENCES warehouses (id),
  product_id text NOT NULL REFERENCES products (id),
  quantity integer NOT NULL CHECK (quantity >= 0),
  PRIMARY KEY (warehouse_id, product_id)
);

CREATE TABLE delivery_records (
  id text PRIMARY KEY,
  warehouse_id text NOT NULL REFERENCES warehouses (id),
  day text NOT NULL CHECK (day IN ('Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun')),
  start_time time NOT NULL,
  duration_min integer NOT NULL CHECK (duration_min > 0)
);

CREATE TABLE orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ordered_at timestamptz NOT NULL,
  items jsonb NOT NULL,
  plan jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Access control. The app connects as the table owner, which is not subject to RLS.
-- With RLS on and no policies, the public Supabase Data API sees no rows, and the revokes
-- take away the table privileges from its two public roles as well.
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE warehouses ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock ENABLE ROW LEVEL SECURITY;
ALTER TABLE delivery_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
