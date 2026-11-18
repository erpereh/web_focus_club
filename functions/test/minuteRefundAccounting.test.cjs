const assert = require('node:assert/strict');
const test = require('node:test');
const { bonoEffectiveMinutes, validBonoMinutes } = require('../lib/bonoMinutes.js');
const { hasFullMinuteRefund } = require('../lib/refundAccounting.js');
const { selectRefundDestination } = require('../lib/minuteRefunds.js');
test('legacy booleans and timestamps never override evidence of a capped or partial refund', () => {
  assert.equal(hasFullMinuteRefund({ minutesRefunded: true, minutesRefundedAt: 'past', minutesRefundedAmount: 60, minutesRefundCappedAmount: 60 }), false);
  assert.equal(hasFullMinuteRefund({ minutesRefunded: true, minutesRefundRequestedAmount: 60, minutesRefundedAmount: 30 }), false);
  assert.equal(hasFullMinuteRefund({ minutesRefundRequestedAmount: 60, minutesRefundedAmount: 60, minutesRefundPendingAmount: 0 }), true);
});
test('effective capacity preserves contracted minutes, legacy extensions and recovered extras', () => {
  for (const remaining of [300, 240, 180, 0]) {
    const b = { tamano: 240, minutosCapacidadBase: 240, minutosExtraRecuperados: 60, minutosTotales: 300, minutosRestantes: remaining };
    assert.equal(bonoEffectiveMinutes(b), 300); assert.equal(validBonoMinutes(b), true);
  }
  assert.equal(bonoEffectiveMinutes({ tamano: 240, minutosTotales: 270, sesionesTotales: 100 }), 270);
  assert.equal(validBonoMinutes({ tamano: 240, minutosCapacidadBase: 240, minutosExtraRecuperados: 60, minutosTotales: 240 }), false);
});
test('a missing, replaced, invalid or ambiguous destination never falls back arbitrarily', () => {
  const now = new Date('2026-11-13T12:00:00Z');
  const b = { id: 'b', userId: 'u', estado: 'agotado', tamano: 240, minutosTotales: 240, minutosRestantes: 0, createdAt: '2026-11-01' };
  assert.equal(selectRefundDestination([], 'u', now).state, 'waiting_bono');
  assert.equal(selectRefundDestination([{ ...b, replacedByBonoId: 'other' }], 'u', now).state, 'waiting_bono');
  assert.equal(selectRefundDestination([b, { ...b, id: 'c' }], 'u', now).state, 'blocked');
  assert.equal(selectRefundDestination([{ ...b, fechaExpiracion: 'invalid' }], 'u', now).state, 'blocked');
  assert.equal(selectRefundDestination([{ ...b, fechaAsignacion: '2026-12-01' }], 'u', now).state, 'waiting_bono');
});

test('a released reservation is not charged again while its refund is still pending', () => {
  const { chargeableMinutesOf } = require('../lib/cancellationCharge.js');
  assert.equal(chargeableMinutesOf({ minutesDeducted: true, minutesDeductedAt: 'past', minutesDeductedAmount: 60,
    minutesRefundRequestedAt: 'released', minutesRefundedAt: null, minutesRefundedAmount: 0, minutesRefundPendingAmount: 60 }), 0);
});

test('historical import preserves a known credit date and never fabricates an unknown one', () => {
  const { recordMinuteRefund } = require('../lib/minuteRefunds.js');
  const db = { collection: (collection) => ({ doc: (id) => ({ id, path: `${collection}/${id}` }) }) };
  const tx = { create() {}, set() {} };
  const source = { userId: 'u', bonoId: 'b', minutesDeducted: true, minutesDeductedAmount: 60, minutesDeductedAt: '2026-01-01' };
  for (const previous of [null, '2026-10-01T10:00:00Z']) {
    const result = recordMinuteRefund(tx, db, { id: 'a' }, { ...source, minutesRefundedAt: previous }, '2026-11-13T12:00:00Z', { credited: 30, historical: true });
    assert.equal(result.refund.lastCreditedAt, previous);
  }
});
