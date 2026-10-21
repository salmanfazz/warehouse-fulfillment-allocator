// Starting catalogue and stock for the demo. Column names match the tables.
// BASELINE_STOCK is what a reset restores. Pairs not listed here hold no stock.

export const PRODUCTS = [
  {
    id: 'P001',
    name: 'Surgical Gloves (Box of 100)',
    category: 'Medical Supplies',
    requires_cold_chain: false,
  },
  {
    id: 'P002',
    name: 'Vaccine - Hepatitis B (10-dose vial)',
    category: 'Pharmaceutical',
    requires_cold_chain: true,
  },
  {
    id: 'P003',
    name: 'Disposable Syringe (Box of 50)',
    category: 'Medical Supplies',
    requires_cold_chain: false,
  },
  {
    id: 'P004',
    name: 'Vaccine - Tetanus Toxoid (10-dose vial)',
    category: 'Pharmaceutical',
    requires_cold_chain: true,
  },
  {
    id: 'P005',
    name: 'Paracetamol Tablets (Box of 100)',
    category: 'Pharmaceutical',
    requires_cold_chain: false,
  },
];

export const WAREHOUSES = [
  {
    id: 'W01',
    city: 'Surabaya',
    distance_km: 5,
    has_cold_storage: false,
    has_refrigerated_vehicle: false,
  },
  {
    id: 'W02',
    city: 'Surabaya',
    distance_km: 12,
    has_cold_storage: true,
    has_refrigerated_vehicle: false,
  },
  {
    id: 'W03',
    city: 'Sidoarjo',
    distance_km: 25,
    has_cold_storage: false,
    has_refrigerated_vehicle: false,
  },
  {
    id: 'W04',
    city: 'Gresik',
    distance_km: 30,
    has_cold_storage: true,
    has_refrigerated_vehicle: true,
  },
  {
    id: 'W05',
    city: 'Malang',
    distance_km: 90,
    has_cold_storage: false,
    has_refrigerated_vehicle: false,
  },
  {
    id: 'W06',
    city: 'Malang',
    distance_km: 95,
    has_cold_storage: true,
    has_refrigerated_vehicle: false,
  },
  {
    id: 'W07',
    city: 'Pasuruan',
    distance_km: 45,
    has_cold_storage: true,
    has_refrigerated_vehicle: true,
  },
  {
    id: 'W08',
    city: 'Jember',
    distance_km: 150,
    has_cold_storage: true,
    has_refrigerated_vehicle: true,
  },
];

export const BASELINE_STOCK = [
  { warehouse_id: 'W01', product_id: 'P001', quantity: 200 },
  { warehouse_id: 'W01', product_id: 'P003', quantity: 500 },
  { warehouse_id: 'W01', product_id: 'P005', quantity: 300 },
  { warehouse_id: 'W02', product_id: 'P001', quantity: 50 },
  { warehouse_id: 'W02', product_id: 'P002', quantity: 30 },
  { warehouse_id: 'W02', product_id: 'P004', quantity: 20 },
  { warehouse_id: 'W03', product_id: 'P001', quantity: 300 },
  { warehouse_id: 'W03', product_id: 'P003', quantity: 200 },
  { warehouse_id: 'W04', product_id: 'P002', quantity: 40 },
  { warehouse_id: 'W04', product_id: 'P004', quantity: 25 },
  { warehouse_id: 'W04', product_id: 'P005', quantity: 100 },
  { warehouse_id: 'W05', product_id: 'P001', quantity: 400 },
  { warehouse_id: 'W05', product_id: 'P003', quantity: 300 },
  { warehouse_id: 'W05', product_id: 'P005', quantity: 500 },
  { warehouse_id: 'W06', product_id: 'P002', quantity: 20 },
  { warehouse_id: 'W06', product_id: 'P003', quantity: 100 },
  { warehouse_id: 'W06', product_id: 'P004', quantity: 30 },
  { warehouse_id: 'W07', product_id: 'P001', quantity: 150 },
  { warehouse_id: 'W07', product_id: 'P002', quantity: 8 },
  { warehouse_id: 'W07', product_id: 'P004', quantity: 10 },
  { warehouse_id: 'W08', product_id: 'P002', quantity: 60 },
  { warehouse_id: 'W08', product_id: 'P004', quantity: 50 },
  { warehouse_id: 'W08', product_id: 'P005', quantity: 200 },
];
