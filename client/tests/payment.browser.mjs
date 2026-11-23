import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { after, before, describe, it } from 'node:test';

const base = new URL(process.env.PAYMENT_TEST_BASE_URL ?? 'http://localhost:3033');
assert.ok(
  ['localhost', '127.0.0.1'].includes(base.hostname),
  'payment browser tests require a local test server',
);
assert.ok(
  process.env.PLAYWRIGHT_MODULE_PATH,
  'Set PLAYWRIGHT_MODULE_PATH to an existing Playwright installation',
);
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE_PATH);
let browser;

const created = '2026-11-19T10:00:00.000Z';
const customer = {
  id: '64b000000000000000000010',
  email: 'payment-browser@example.test',
  name: 'Payment Browser Customer',
  role: 'customer',
  addresses: [
    {
      _id: '64b000000000000000000011',
      fullName: 'Payment Browser Customer',
      phone: '01712345678',
      line1: 'House 1, Road 1',
      city: 'Dhaka',
      country: 'Bangladesh',
      isDefault: true,
    },
  ],
};
const cart = {
  items: [
    {
      variantId: '64b000000000000000000030',
      product: '64b000000000000000000031',
      name: 'Payment Test Shirt',
      sku: 'PAY-SHIRT-M',
      size: 'M',
      color: null,
      image: null,
      unitPrice: 10000,
      quantity: 1,
      lineTotal: 10000,
      outOfStock: false,
      insufficientStock: false,
      unavailable: false,
    },
  ],
  subtotal: 10000,
  shippingFee: 0,
  total: 10000,
};
const enabledMethods = [
  {
    method: 'cod',
    provider: 'cod',
    label: 'Cash on Delivery',
    enabled: true,
    receivingNumber: null,
    instructions: ['Pay in cash to the delivery person when your order arrives.'],
    requiresProof: false,
  },
  {
    method: 'bkash',
    provider: 'manual',
    label: 'bKash',
    enabled: true,
    receivingNumber: '01711111111',
    instructions: ['Send the exact total to the bKash receiving number.'],
    requiresProof: true,
    trxIdMinLength: 6,
    trxIdMaxLength: 32,
  },
  {
    method: 'nagad',
    provider: 'manual',
    label: 'Nagad',
    enabled: false,
    receivingNumber: null,
    instructions: [],
    requiresProof: true,
    trxIdMinLength: 6,
    trxIdMaxLength: 32,
  },
  {
    method: 'rocket',
    provider: 'manual',
    label: 'Rocket',
    enabled: false,
    receivingNumber: null,
    instructions: [],
    requiresProof: true,
    trxIdMinLength: 6,
    trxIdMaxLength: 32,
  },
];

const makeOrder = (overrides = {}) => ({
  id: '64b000000000000000000001',
  orderNumber: 'AL-20261119-PAY1',
  status: 'pending',
  paymentMethod: 'bkash',
  paymentStatus: 'awaiting_payment',
  payment: {
    provider: 'manual',
    senderNumber: null,
    trxId: null,
    submittedAt: null,
    verifiedBy: null,
    verifiedAt: null,
    rejectionReason: null,
    refundedBy: null,
    refundedAt: null,
    refundReference: null,
    refundAmount: null,
    refundRecipient: null,
    refundNote: null,
    claims: [],
    verificationHistory: [],
  },
  items: [
    {
      product: '64b000000000000000000031',
      variant: '64b000000000000000000030',
      name: 'Payment Test Shirt',
      sku: 'PAY-SHIRT-M',
      size: 'M',
      color: null,
      image: null,
      unitPrice: 10000,
      quantity: 1,
      lineTotal: 10000,
    },
  ],
  shippingAddress: {
    fullName: 'Payment Browser Customer',
    phone: '01712345678',
    line1: 'House 1, Road 1',
    city: 'Dhaka',
    country: 'Bangladesh',
  },
  subtotal: 10000,
  shippingFee: 0,
  total: 10000,
  statusHistory: [{ status: 'pending', at: created }],
  createdAt: created,
  ...overrides,
});

async function fixture(test, options = {}) {
  const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
  test.after(() => context.close());
  const state = {
    order: options.order ?? makeOrder(),
    methods: options.methods ?? enabledMethods,
    manualPaymentsUnavailable: options.manualPaymentsUnavailable ?? false,
  };
  await context.route('**/*', (route) =>
    new URL(route.request().url()).origin === base.origin ? route.continue() : route.abort(),
  );
  await context.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    let body = {};
    if (url.pathname === '/api/auth/me') body = { user: customer };
    else if (url.pathname === '/api/cart') body = cart;
    else if (url.pathname === '/api/users/me/addresses') body = { items: customer.addresses };
    else if (url.pathname === '/api/notifications') body = { items: [] };
    else if (url.pathname === '/api/payments/methods') {
      body = {
        methods: state.methods,
        manualPaymentsUnavailable: state.manualPaymentsUnavailable,
      };
    } else if (url.pathname === '/api/orders' && request.method() === 'POST') {
      body = { order: state.order };
    } else if (url.pathname === `/api/orders/${state.order.id}` && request.method() === 'GET') {
      body = { order: state.order };
    } else if (
      url.pathname === `/api/orders/${state.order.id}/payment` &&
      request.method() === 'POST'
    ) {
      state.order = makeOrder({
        paymentStatus: 'pending_verification',
        payment: {
          ...state.order.payment,
          senderNumber: '01712345678',
          trxId: 'BROWSER1',
          submittedAt: created,
          claims: [
            {
              id: '64b000000000000000000040',
              senderNumber: '01712345678',
              trxId: 'BROWSER1',
              submittedAt: created,
              status: 'pending_verification',
              reviewedBy: null,
              reviewedAt: null,
              rejectionReason: null,
            },
          ],
          verificationHistory: [
            { action: 'submitted', at: created, actor: 'customer', by: null, reason: null },
          ],
        },
      });
      body = { order: state.order };
    }
    await route.fulfill({ status: 200, json: body });
  });
  const page = await context.newPage();
  return { page, state };
}

describe('Phase 2 payment browser regressions', () => {
  before(async () => {
    browser = await chromium.launch({
      headless: true,
      ...(process.env.BROWSER_EXECUTABLE_PATH
        ? { executablePath: process.env.BROWSER_EXECUTABLE_PATH }
        : {}),
    });
  });
  after(async () => {
    await browser?.close();
  });

  it('shows enabled/disabled methods and the exact receiving number at mobile width', async (t) => {
    const { page } = await fixture(t);
    await page.goto(new URL('/checkout', base).href);
    await page.getByText('Cash on Delivery', { exact: true }).waitFor();
    await page.getByText('bKash', { exact: true }).waitFor();
    assert.equal(await page.locator('input[name="payment-method"][value="nagad"]').isDisabled(), true);
    await page.locator('input[name="payment-method"][value="bkash"]').click();
    await page.getByText('01711111111', { exact: true }).waitFor();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    assert.ok(overflow <= 1, `checkout overflow ${overflow}px`);
  });

  it('shows the manual proof form and pending state', async (t) => {
    const { page } = await fixture(t);
    await page.goto(new URL(`/orders/${makeOrder().id}`, base).href);
    await page.getByText('Submit your payment details', { exact: true }).waitFor();
    await page.getByLabel('Sender wallet number', { exact: true }).fill('01712345678');
    await page.getByLabel('Transaction ID', { exact: true }).fill('BROWSER1');
    await page.getByRole('button', { name: 'Submit for verification', exact: true }).click();
    await page.getByText('Your payment is being verified.', { exact: true }).waitFor();
    assert.equal(await page.getByText('01711111111', { exact: true }).count(), 0);
  });

  it('keeps refund evidence visible when the provider is disabled', async (t) => {
    const refunded = makeOrder({
      status: 'cancelled',
      paymentStatus: 'refunded',
      payment: {
        ...makeOrder().payment,
        senderNumber: '01712345678',
        trxId: 'BROWSER1',
        submittedAt: created,
        verifiedBy: '64b000000000000000000020',
        verifiedAt: created,
        refundedBy: '64b000000000000000000020',
        refundedAt: created,
        refundReference: 'REF-UI-1',
        refundAmount: 10000,
        refundRecipient: '01712345678',
        refundNote: null,
        claims: [
          {
            id: '64b000000000000000000040',
            senderNumber: '01712345678',
            trxId: 'BROWSER1',
            submittedAt: created,
            status: 'approved',
            reviewedBy: '64b000000000000000000020',
            reviewedAt: created,
            rejectionReason: null,
          },
        ],
        verificationHistory: [
          { action: 'submitted', at: created, actor: 'customer', by: null, reason: null },
          { action: 'approved', at: created, actor: 'admin', by: null, reason: null },
          {
            action: 'refunded',
            at: created,
            actor: 'admin',
            by: null,
            reason: null,
            refundReference: 'REF-UI-1',
            refundAmount: 10000,
            refundRecipient: '01712345678',
          },
        ],
      },
    });
    const disabledMethods = enabledMethods.map((method) =>
      method.method === 'bkash'
        ? { ...method, enabled: false, receivingNumber: null, instructions: [] }
        : method,
    );
    const { page } = await fixture(t, { order: refunded, methods: disabledMethods });
    await page.goto(new URL(`/orders/${refunded.id}`, base).href);
    const refundNotice = page
      .getByRole('status')
      .filter({ hasText: 'The manual refund for this order is marked complete.' });
    await refundNotice.waitFor();
    await refundNotice.getByText('REF-UI-1', { exact: false }).waitFor();
    await page.getByText('Payment history', { exact: true }).waitFor();
    assert.equal(await page.getByText('Refund pending', { exact: true }).count(), 0);
  });

  it('shows the checkout unavailable notice when manual readiness fails', async (t) => {
    const disabledMethods = enabledMethods.map((method) =>
      method.method === 'cod'
        ? method
        : { ...method, enabled: false, receivingNumber: null, instructions: [] },
    );
    const { page } = await fixture(t, {
      methods: disabledMethods,
      manualPaymentsUnavailable: true,
    });
    await page.goto(new URL('/checkout', base).href);
    await page
      .getByText('Mobile financial services are temporarily unavailable.', { exact: false })
      .waitFor();
    assert.equal(await page.locator('input[name="payment-method"][value="bkash"]').isDisabled(), true);
    assert.equal(await page.locator('input[name="payment-method"][value="cod"]').isChecked(), true);
  });
});
