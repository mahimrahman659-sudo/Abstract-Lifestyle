import assert from 'node:assert/strict';
import { it } from 'node:test';
import { refreshSession } from '../auth/refresh-session.ts';

it('accepts a successfully refreshed profile', async () => {
  const accepted: Array<string | null> = [];
  assert.equal((await refreshSession(async () => ({ user: 'saved' }), (user) => accepted.push(user))).status, 'ok');
  assert.deepEqual(accepted, ['saved']);
});
for (const [label, error] of [
  ['network failure', new TypeError('Failed to fetch')],
  ['timeout', Object.assign(new Error('Timed out'), { name: 'TimeoutError' })],
  ['server 503', Object.assign(new Error('Unavailable'), { status: 503 })],
] as const) {
  it(`preserves the authenticated profile after ${label}`, async () => {
    let current: string | null = 'confirmed saved profile';
    const result = await refreshSession<string>(async () => { throw error; }, (user) => { current = user; });
    assert.equal(result.status, 'error');
    assert.equal(current, 'confirmed saved profile');
  });
}
for (const status of [401, 403]) {
  it(`expires authentication on HTTP ${status}`, async () => {
    let current: string | null = 'old profile';
    const result = await refreshSession<string>(async () => { throw { status }; }, (user) => { current = user; });
    assert.equal(result.status, 'expired');
    assert.equal(current, null);
  });
}
it('retries the read after failure and accepts the latest profile', async () => {
  let reads = 0;
  let current: string | null = 'saved';
  const load = async () => { reads++; if (reads === 1) throw new Error('offline'); return { user: 'latest' }; };
  assert.equal((await refreshSession(load, (user) => { current = user; })).status, 'error');
  assert.equal((await refreshSession(load, (user) => { current = user; })).status, 'ok');
  assert.equal(current, 'latest'); assert.equal(reads, 2);
});
