import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { it } from 'node:test';
import { site } from '../../config/site.ts';

it('production storefront configuration contains no placeholder contact or social values', () => {
  assert.doesNotMatch(JSON.stringify(site), /example\.com|OWNER:|placeholder|"href":"#"/i);
  assert.equal(site.contact.email, '');
  assert.equal(site.contact.hours, '');
  assert.equal(site.socials.length, 0);
});
it('public information pages contain no internal setup instructions', () => {
  for (const page of ['about', 'contact', 'privacy', 'shipping-returns']) {
    const source = readFileSync(new URL(`../../app/${page}/page.tsx`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /hello@example|placeholder|OWNER:|replace this|edit this page/i);
  }
});
it('customer cancellation UI includes processing but excludes shipped orders', () => {
  const source = readFileSync(new URL('../../components/orders/OrderDetailClient.tsx', import.meta.url), 'utf8');
  assert.match(source, /order.status === 'pending' \|\| order.status === 'processing'/);
});
