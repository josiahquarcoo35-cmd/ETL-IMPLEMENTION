function validateRecord(data) {
  const errors = [];
  for (const [key, value] of Object.entries(data)) {
    if (value == null || String(value).trim() === '') errors.push(`${key} is required`);
  }
  if (Object.hasOwn(data, 'product_code') && !String(data.product_code ?? '').trim()) {
    errors.push('product_code must not be blank');
  }
  if (Object.hasOwn(data, 'price')) {
    const price = Number(data.price);
    if (String(data.price ?? '').trim() === '' || !Number.isFinite(price) || price <= 0) {
      errors.push('price must be a number greater than zero');
    }
  }
  return errors;
}
module.exports = { validateRecord };
