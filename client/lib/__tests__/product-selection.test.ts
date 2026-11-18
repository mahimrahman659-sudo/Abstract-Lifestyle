import assert from 'node:assert/strict';
import { it } from 'node:test';
import { pickInitialSelection } from '../catalog/product-selection.ts';

it('selects the first in-stock variant instead of an unavailable first row', () => {
  assert.deepEqual(pickInitialSelection([
    { size: 'M', color: 'Black', stock: 0 },
    { size: 'L', color: 'White', stock: 3 },
  ]), { size: 'L', color: 'White' });
});

it('retains a selection when every variant is sold out', () => {
  assert.deepEqual(pickInitialSelection([{ size: 'M', color: null, stock: 0 }]), { size: 'M', color: null });
});

it('supports a default variant without size or color', () => {
  assert.deepEqual(pickInitialSelection([{ size: null, color: null, stock: 2 }]), { size: null, color: null });
});

it('returns an empty selection for a product without variants', () => {
  assert.deepEqual(pickInitialSelection([]), { size: null, color: null });
});
