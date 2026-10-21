const test = require('node:test');
const assert = require('node:assert/strict');
const { validateRecord } = require('../src/etl');

test('valid record with numeric positive price passes', () => {
  assert.deepEqual(validateRecord({ product_code: 'P001', product_name: 'Keyboard', price: '250' }), []);
});
test('invalid non-numeric price is rejected', () => {
  assert.ok(validateRecord({ product_code: 'P002', product_name: 'Mouse', price: 'invalid' }).some(e => e.includes('price')));
});
test('blank fields are rejected', () => {
  assert.ok(validateRecord({ product_code: 'P003', product_name: '', price: '5' }).some(e => e.includes('product_name')));
});
test('zero and negative prices are rejected', () => {
  assert.ok(validateRecord({ product_code: 'P004', product_name: 'Item', price: '0' }).some(e => e.includes('price')));
  assert.ok(validateRecord({ product_code: 'P005', product_name: 'Item', price: '-1' }).some(e => e.includes('price')));
});
