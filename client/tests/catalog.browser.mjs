import assert from 'node:assert/strict';
import { after, before, it } from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createRequire } from 'node:module';

const base = new URL(process.env.CATALOG_TEST_BASE_URL ?? 'http://localhost:3033');
assert.ok(['localhost', '127.0.0.1'].includes(base.hostname), 'Use a local test client only');
assert.ok(process.env.PLAYWRIGHT_MODULE_PATH, 'Set PLAYWRIGHT_MODULE_PATH to an existing installation');
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE_PATH);
const productId = '333333333333333333333333';
const categoryId = '444444444444444444444444';
const product = { id: productId, slug: 'rendering-fixture', name: 'Rendering fixture', description: 'Synthetic catalog fixture.',
  category: { id: categoryId, name: 'Fixture category', slug: 'fixture-category' }, basePrice: 10000,
  compareAtPrice: null, discountPercent: 0, images: [], createdAt: '2020-01-01T00:00:00.000Z' };
const variants = ['M', 'L'].map((size, index) => ({ id: `55555555555555555555555${index}`, sku: `FIXTURE-${size}`,
  size, color: null, price: 10000, compareAtPrice: null, discountPercent: 0,
  stock: index ? 3 : 0, inStock: index === 1, lowStock: index === 1, images: [] }));
const category = { id: categoryId, name: 'Fixture category', slug: 'fixture-category', sortOrder: 0, children: [] };
let browser;
let api;

before(async () => {
  // Build/start the local client with API_URL=http://127.0.0.1:4084.
  // SSR must exercise the actual server/client boundary, not a mocked page.
  api = createServer((request, response) => {
    const path = new URL(request.url, 'http://127.0.0.1').pathname;
    let status = 200; let body;
    if (request.method !== 'GET') { status = 405; body = {}; }
    else if (path === `/api/products/${product.slug}`) body = { product, variants, sizeGuideKey: null };
    else if (path === '/api/categories') body = { items: [category] };
    else if (path === '/api/products') body = { items: [], page: 1, limit: 5, total: 0, totalPages: 0 };
    else if (path === '/api/site-images') body = { items: [] };
    else { status = 404; body = { error: { code: 'NOT_FOUND', message: 'Product not found' } }; }
    response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(body));
  }).listen(4084, '127.0.0.1');
  await once(api, 'listening');
  browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE_PATH ? { executablePath: process.env.BROWSER_EXECUTABLE_PATH } : {}) });
});
after(async () => {
  await browser?.close();
  if (api) await new Promise((resolve, reject) => api.close((error) => error ? reject(error) : resolve()));
});

async function fixture(test, options = {}) {
  const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
  test.after(() => context.close());
  const state = { deletes: 0, categoryExists: true, status: 'active' };
  await context.route('**/*', (route) => new URL(route.request().url()).origin === base.origin ? route.continue() : route.abort());
  await context.route('**/api/**', async (route) => {
    const request = route.request(); const path = new URL(request.url()).pathname;
    let status = 200; let body = { items: [] };
    if (path === '/api/auth/me') body = { user: { id: '111111111111111111111111', name: 'Fixture admin', email: 'admin@example.test', role: 'admin', addresses: [] } };
    else if (path === '/api/categories') body = { items: state.categoryExists ? [category] : [] };
    else if (path === `/api/admin/categories/${categoryId}` && request.method() === 'DELETE') {
      state.deletes++;
      if (options.categoryConflict) { status = 409; body = { error: { code: 'CONFLICT', message: 'This category still has 1 product. Move it to another category first.' } }; }
      else { state.categoryExists = false; status = 204; }
    } else if (path === `/api/admin/products/${productId}` && request.method() === 'DELETE') {
      state.deletes++;
      if (options.productFailure) { status = 500; body = { error: { code: 'SERVER_ERROR', message: 'Injected delete failure' } }; }
      else if (options.ordered) { state.status = 'archived'; body = { archived: true, orders: 1 }; }
      else status = 204;
    } else if (path === `/api/admin/products/${productId}`) body = { product: { ...product, category: categoryId, status: state.status, variantCount: 0, totalStock: 0 }, variants: [] };
    else if (path === '/api/admin/products') body = { items: [], page: 1, limit: 10, total: 0, totalPages: 0 };
    else if (path === '/api/cart') body = { items: [], subtotal: 0, shippingFee: 0, total: 0 };
    await route.fulfill(status === 204 ? { status } : { status, json: body });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.setDefaultNavigationTimeout(45000);
  const renderErrors = [];
  page.on('pageerror', (error) => renderErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && /Minified React error|hydration|Server Components render/i.test(message.text())) renderErrors.push(message.text());
  });
  test.after(() => assert.deepEqual(renderErrors, [], 'no rendering or hydration errors'));
  return { page, state };
}

it('renders the product page and selects an in-stock variant across the server/client boundary', async (t) => {
  const { page } = await fixture(t); const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && /Minified React error|hydration|Server Components render/i.test(message.text())) errors.push(message.text());
  });
  const response = await page.goto(new URL(`/products/${product.slug}`, base).href);
  assert.equal(response.status(), 200);
  await page.getByRole('heading', { name: product.name, exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'L', exact: true }).getAttribute('aria-pressed'), 'true');
  assert.ok(await page.getByRole('button', { name: /add to cart/i }).count());
  assert.equal(await page.getByText('Could not load this product', { exact: true }).count(), 0);
  assert.deepEqual(errors, []);
});

it('deletes an empty category through the confirmation dialog and removes its row', async (t) => {
  const { page, state } = await fixture(t); await page.goto(new URL('/admin/categories', base).href);
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await page.getByRole('dialog', { name: 'Delete category?' }).getByRole('button', { name: 'Delete category', exact: true }).click();
  await page.getByText(/Category .* deleted\./).waitFor();
  await page.getByText('No categories yet', { exact: true }).waitFor(); assert.equal(state.deletes, 1);
});

it('shows a category dependency conflict and preserves the category row', async (t) => {
  const { page, state } = await fixture(t, { categoryConflict: true }); await page.goto(new URL('/admin/categories', base).href);
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await page.getByRole('dialog', { name: 'Delete category?' }).getByRole('button', { name: 'Delete category', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'This category still has 1 product.' }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Delete', exact: true }).count(), 1); assert.equal(state.deletes, 1);
});

it('handles product DELETE 204 without parsing JSON and returns to the product list', async (t) => {
  const { page, state } = await fixture(t); await page.goto(new URL(`/admin/products/${productId}`, base).href);
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await page.getByRole('dialog', { name: 'Delete product?' }).getByRole('button', { name: 'Delete product', exact: true }).click();
  await page.waitForURL(new URL('/admin/products', base).href); assert.equal(state.deletes, 1);
});

it('explains when deleting an ordered product archives it and keeps its admin page', async (t) => {
  const { page, state } = await fixture(t, { ordered: true }); await page.goto(new URL(`/admin/products/${productId}`, base).href);
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await page.getByRole('dialog', { name: 'Delete product?' }).getByRole('button', { name: 'Delete product', exact: true }).click();
  await page.getByText(/so it was archived instead of deleted/).waitFor();
  assert.equal(new URL(page.url()).pathname, `/admin/products/${productId}`); assert.equal(state.deletes, 1);
});

it('shows product deletion failures without reporting success or redirecting', async (t) => {
  const { page, state } = await fixture(t, { productFailure: true }); await page.goto(new URL(`/admin/products/${productId}`, base).href);
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await page.getByRole('dialog', { name: 'Delete product?' }).getByRole('button', { name: 'Delete product', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'Injected delete failure' }).waitFor();
  assert.equal(new URL(page.url()).pathname, `/admin/products/${productId}`); assert.equal(state.deletes, 1);
});
