import { describe, expect, it } from 'vitest';
import { toDeliveryRecord, toProduct, toStockRow, toWarehouse } from '@/db/mappers';

const stockRow = { warehouse_id: 'W01', product_id: 'P001', quantity: 200 };
const warehouseRow = {
  id: 'W04',
  city: 'Gresik',
  distance_km: 30,
  has_cold_storage: true,
  has_refrigerated_vehicle: true,
};
const productRow = {
  id: 'P002',
  name: 'Vaccine',
  category: 'Pharmaceutical',
  requires_cold_chain: true,
};
const deliveryRow = {
  id: 'DL001',
  warehouse_id: 'W01',
  day: 'Mon',
  start_time: '08:00:00',
  duration_min: 50,
};

describe('row mappers', () => {
  it('maps_a_product_row', () => {
    expect(toProduct(productRow)).toEqual({
      id: 'P002',
      name: 'Vaccine',
      category: 'Pharmaceutical',
      requiresColdChain: true,
    });
  });

  it('maps_a_warehouse_row', () => {
    expect(toWarehouse(warehouseRow)).toEqual({
      id: 'W04',
      city: 'Gresik',
      distanceKm: 30,
      hasColdStorage: true,
      hasRefrigeratedVehicle: true,
    });
  });

  it('maps_a_stock_row', () => {
    expect(toStockRow(stockRow)).toEqual({ warehouseId: 'W01', productId: 'P001', quantity: 200 });
  });

  it('maps_a_delivery_row_and_keeps_hh_mm_ss', () => {
    expect(toDeliveryRecord(deliveryRow)).toEqual({
      warehouseId: 'W01',
      day: 'Mon',
      startTime: '08:00:00',
      durationMin: 50,
    });
  });

  it('rejects_a_string_quantity_and_names_the_column', () => {
    expect(() => toStockRow({ ...stockRow, quantity: '200' })).toThrow(TypeError);
    expect(() => toStockRow({ ...stockRow, quantity: '200' })).toThrow(/quantity/);
  });

  it('rejects_a_string_distance', () => {
    expect(() => toWarehouse({ ...warehouseRow, distance_km: '30' })).toThrow(/distance_km/);
  });

  it('rejects_null_and_undefined_numbers', () => {
    expect(() => toStockRow({ ...stockRow, quantity: null })).toThrow(TypeError);
    expect(() => toStockRow({ warehouse_id: 'W01', product_id: 'P001' })).toThrow(/quantity/);
    expect(() => toDeliveryRecord({ ...deliveryRow, duration_min: undefined })).toThrow(
      /duration_min/,
    );
  });

  it('rejects_nan_infinity_and_fractions', () => {
    for (const quantity of [Number.NaN, Number.POSITIVE_INFINITY, 1.5]) {
      expect(() => toStockRow({ ...stockRow, quantity }), String(quantity)).toThrow(TypeError);
    }
  });

  it('rejects_a_non_boolean_flag', () => {
    expect(() => toWarehouse({ ...warehouseRow, has_cold_storage: 'true' })).toThrow(
      /has_cold_storage/,
    );
    expect(() => toProduct({ ...productRow, requires_cold_chain: 1 })).toThrow(
      /requires_cold_chain/,
    );
  });

  it('rejects_a_missing_text_column', () => {
    expect(() => toProduct({ ...productRow, name: null })).toThrow(/name/);
  });

  it('the_error_message_names_the_type_not_the_value', () => {
    expect(() => toStockRow({ ...stockRow, quantity: 'secret-value' })).not.toThrow(/secret-value/);
    try {
      toStockRow({ ...stockRow, quantity: 'secret-value' });
    } catch (err) {
      expect((err as Error).message).not.toContain('secret-value');
    }
  });
});
