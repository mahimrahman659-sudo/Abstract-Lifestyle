import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { createRequire } from 'node:module';

const base = new URL(process.env.ACCOUNT_TEST_BASE_URL ?? 'http://localhost:3033');
assert.ok(['localhost', '127.0.0.1'].includes(base.hostname), 'browser tests require a local test server');
assert.ok(process.env.PLAYWRIGHT_MODULE_PATH, 'Set PLAYWRIGHT_MODULE_PATH to an existing Playwright installation');
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE_PATH);
let browser;

before(async () => {
  browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE_PATH ? { executablePath: process.env.BROWSER_EXECUTABLE_PATH } : {}) });
});
after(async () => { await browser?.close(); });

async function fixture(test, options = {}) {
  const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
  test.after(() => context.close());
  const user = { id: '111111111111111111111111', name: 'Account Customer', email: 'account-fixture@example.test', role: 'customer', addresses: [{
    _id: '222222222222222222222222', fullName: 'Account Customer', phone: '01712345678', line1: 'Old street',
    label: 'Home', line2: 'Flat 4', city: 'Dhaka', state: 'Dhaka', postalCode: '1200', country: 'Bangladesh', isDefault: true,
  }] };
  const state = { reads: 0, writes: 0, failRead: options.initialFailure ?? 0, afterSave: options.afterSave ?? 0, writeStatus: options.writeStatus ?? 200, addressPayload: null };
  // Every API response is synthetic. No account or database write reaches a server.
  await context.route('**/*', (route) => new URL(route.request().url()).origin === base.origin ? route.continue() : route.abort());
  await context.route('**/api/**', async (route) => {
    const request = route.request(); const url = new URL(request.url());
    let status = 200; let body = { items: [] };
    if (url.pathname === '/api/auth/me') {
      state.reads++;
      status = state.failRead || 200;
      body = status === 200 ? { user } : { error: { code: 'SERVER_ERROR', message: 'Injected read failure' } };
    } else if (url.pathname === '/api/users/me' && request.method() === 'PATCH') {
      state.writes++; status = state.writeStatus;
      if (status === 200) { user.name = request.postDataJSON().name; state.failRead = state.afterSave; body = { user }; }
      else body = { error: { code: 'UNAUTHORIZED', message: 'Session expired' } };
    } else if (url.pathname.includes('/users/me/addresses/') && request.method() === 'PATCH') {
      state.writes++; state.addressPayload = request.postDataJSON();
      Object.assign(user.addresses[0], state.addressPayload); body = { address: user.addresses[0] };
    } else if (url.pathname === '/api/cart') body = { items: [], subtotal: 0, shippingFee: 0, total: 0 };
    await route.fulfill({ status, json: body });
  });
  const page = await context.newPage(); await page.goto(new URL('/account', base).href);
  return { page, state, user };
}

describe('corrective account browser regressions', () => {
  it('saves and refreshes once, preserving the confirmed name', async (t) => {
    const { page, state, user } = await fixture(t);
    await page.getByLabel('Your name', { exact: true }).fill('Saved Customer');
    await page.getByRole('button', { name: 'Save name', exact: true }).click();
    await page.getByText('Profile saved.', { exact: true }).waitFor();
    assert.equal(state.writes, 1); assert.equal(user.name, 'Saved Customer');
    assert.equal(await page.getByLabel('Your name', { exact: true }).inputValue(), 'Saved Customer');
    assert.equal(state.reads, 2);
  });

  it('retains a successful save after failed refresh, then retries only the read', async (t) => {
    const { page, state, user } = await fixture(t, { afterSave: 503 });
    await page.getByLabel('Your name', { exact: true }).fill('Confirmed Customer');
    await page.getByRole('button', { name: 'Save name', exact: true }).click();
    await page.getByText(/Profile saved\. The latest account information could not be refreshed/).waitFor();
    assert.equal(new URL(page.url()).pathname, '/account'); assert.equal(user.name, 'Confirmed Customer');
    assert.equal(await page.getByLabel('Your name', { exact: true }).inputValue(), 'Confirmed Customer');
    assert.equal(await page.getByRole('button', { name: 'Save name', exact: true }).isDisabled(), true);
    await page.getByLabel('Your name', { exact: true }).fill('Unsaved next edit');
    state.failRead = 0;
    await page.getByRole('button', { name: 'Retry refresh', exact: true }).click();
    await page.getByText('Latest account information refreshed.', { exact: true }).waitFor();
    assert.equal(state.writes, 1); assert.equal(state.reads, 3);
    assert.equal(await page.getByLabel('Your name', { exact: true }).inputValue(), 'Unsaved next edit');
    assert.equal(await page.getByRole('button', { name: 'Retry refresh', exact: true }).count(), 0);
  });

  for (const status of [401, 403]) {
    it(`redirects for a genuinely unauthorized refresh (${status})`, async (t) => {
      const { page, state } = await fixture(t, { afterSave: status });
      await page.getByLabel('Your name', { exact: true }).fill('Saved before expiration');
      await page.getByRole('button', { name: 'Save name', exact: true }).click();
      await page.waitForURL(/\/login/); assert.equal(state.writes, 1);
    });
  }

  it('redirects when the update request itself reports an expired session', async (t) => {
    const { page, state } = await fixture(t, { writeStatus: 401 });
    await page.getByRole('button', { name: 'Save name', exact: true }).click();
    await page.waitForURL(/\/login/); assert.equal(state.writes, 1);
  });

  it('keeps an initial transient profile failure on the account route with a retry', async (t) => {
    const { page, state } = await fixture(t, { initialFailure: 503 });
    await page.getByText('Could not load your account', { exact: true }).waitFor();
    assert.equal(new URL(page.url()).pathname, '/account');
    state.failRead = 0;
    await page.getByRole('button', { name: /try again|retry/i }).click();
    await page.getByLabel('Your name', { exact: true }).waitFor(); assert.equal(state.writes, 0);
  });

  it('displays, edits and clears all optional address values and rejects invalid required fields', async (t) => {
    const { page, state } = await fixture(t);
    await page.getByRole('button', { name: 'Edit address', exact: true }).click();
    const fields = [
      ['label', 'Address label (optional)', 'Home'], ['line2', 'Address line 2 (optional)', 'Flat 4'],
      ['city', 'City (optional)', 'Dhaka'], ['state', 'State or region (optional)', 'Dhaka'],
      ['postalCode', 'Postal code (optional)', '1200'], ['country', 'Country (optional)', 'Bangladesh'],
    ];
    for (const [key, label, value] of fields) {
      assert.equal(await page.getByLabel(label, { exact: true }).inputValue(), value);
      await page.getByLabel(label, { exact: true }).fill(`New ${key}`);
    }
    await page.getByLabel('Phone number', { exact: true }).fill('invalid');
    await page.getByRole('button', { name: 'Save address', exact: true }).click();
    await page.getByText('Enter a valid Bangladeshi mobile number.', { exact: true }).waitFor();
    assert.equal(state.writes, 0);
    await page.getByLabel('Phone number', { exact: true }).fill('+8801712345678');
    await page.getByRole('button', { name: 'Save address', exact: true }).click();
    await page.getByText('Address saved.', { exact: true }).waitFor();
    for (const [key] of fields) assert.equal(state.addressPayload[key], `New ${key}`);
    for (const [, label] of fields) await page.getByLabel(label, { exact: true }).fill('');
    const cleared = page.waitForResponse((response) => response.url().includes('/users/me/addresses/') && response.request().method() === 'PATCH');
    await page.getByRole('button', { name: 'Save address', exact: true }).click(); await cleared;
    for (const [key] of fields) assert.equal(state.addressPayload[key], '');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  });
});
