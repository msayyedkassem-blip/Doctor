import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DurabilityKind } from './inco.js';
import {
  OrderStatus, canTransition, assertTransition, isDispatched,
  withdrawalRight, WithdrawalExemption, allocateFefo, type StockBatch,
} from './order.js';

describe('order state machine', () => {
  it('allows the happy path', () => {
    const path: OrderStatus[] = ['PENDING_PAYMENT', 'PAID', 'PREPARING', 'SHIPPED', 'DELIVERED'];
    for (let i = 0; i < path.length - 1; i++) {
      assert.ok(canTransition(path[i]!, path[i + 1]!), `${path[i]} -> ${path[i + 1]}`);
    }
  });

  it('refuses to skip payment', () => {
    assert.equal(canTransition(OrderStatus.PENDING_PAYMENT, OrderStatus.SHIPPED), false);
    assert.throws(() => assertTransition(OrderStatus.PENDING_PAYMENT, OrderStatus.SHIPPED));
  });

  it('refuses to un-ship or resurrect a terminal order', () => {
    assert.equal(canTransition(OrderStatus.SHIPPED, OrderStatus.PREPARING), false);
    assert.equal(canTransition(OrderStatus.CANCELLED, OrderStatus.PAID), false);
    assert.equal(canTransition(OrderStatus.REFUNDED, OrderStatus.PAID), false);
  });

  it('knows when stock has left the building', () => {
    assert.equal(isDispatched(OrderStatus.SHIPPED), true);
    assert.equal(isDispatched(OrderStatus.PAID), false);
  });
});

describe('withdrawalRight', () => {
  const deliveredAt = new Date('2026-09-01T00:00:00Z');

  it('APPLIES to sealed shelf-stable groceries — they are not "rapidly perishable"', () => {
    const r = withdrawalRight({ durabilityKind: DurabilityKind.DDM, sealBroken: false, deliveredAt });
    assert.equal(r.applies, true);
    assert.equal(r.deadline?.toISOString().slice(0, 10), '2026-09-15');
  });

  it('is excluded once the customer breaks the seal', () => {
    const r = withdrawalRight({ durabilityKind: DurabilityKind.DDM, sealBroken: true, deliveredAt });
    assert.equal(r.applies, false);
    assert.equal(r.exemption, WithdrawalExemption.UNSEALED_HYGIENE);
  });

  it('is excluded for DLC perishables', () => {
    const r = withdrawalRight({ durabilityKind: DurabilityKind.DLC, sealBroken: false, deliveredAt });
    assert.equal(r.applies, false);
    assert.equal(r.exemption, WithdrawalExemption.PERISHABLE);
  });
});

describe('allocateFefo', () => {
  const asOf = new Date('2026-09-14T00:00:00Z');
  const batches: StockBatch[] = [
    { id: 'b-late', productId: 'p1', lotNumber: 'L2', durabilityDate: new Date('2027-06-01T00:00:00Z'), quantityOnHand: 10, receivedAt: asOf },
    { id: 'b-soon', productId: 'p1', lotNumber: 'L1', durabilityDate: new Date('2026-11-01T00:00:00Z'), quantityOnHand: 3, receivedAt: asOf },
    { id: 'b-dead', productId: 'p1', lotNumber: 'L0', durabilityDate: new Date('2026-08-01T00:00:00Z'), quantityOnHand: 50, receivedAt: asOf },
  ];

  it('ships the soonest-expiring stock first and skips expired batches', () => {
    const picks = allocateFefo(batches, 5, asOf);
    assert.deepEqual(picks, [
      { batchId: 'b-soon', lotNumber: 'L1', quantity: 3 },
      { batchId: 'b-late', lotNumber: 'L2', quantity: 2 },
    ]);
  });

  it('returns null rather than over-allocating', () => {
    assert.equal(allocateFefo(batches, 99, asOf), null);
  });
});
