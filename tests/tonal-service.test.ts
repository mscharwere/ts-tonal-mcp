import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import TonalClient, { TonalClientError } from '@dlwiest/ts-tonal-client';
import { handleToolError, type TonalMCPError } from '../src/utils/error-handler.js';
import { REJECTED_LOGIN_RETRY_MS, TonalService } from '../src/services/tonal-service.js';

// Fake credentials only. TonalClient.create is always stubbed, so no test ever reaches Tonal.
const USERS = ['usera', 'userb', 'userc'] as const;
for (const user of USERS) {
  process.env[`TONAL_USERNAME_${user.toUpperCase()}`] = `${user}@example.invalid`;
  process.env[`TONAL_PASSWORD_${user.toUpperCase()}`] = `fake-${user}`;
}

type LoginOptions = { username: string; password: string };

// Stubs TonalClient.create. `impl` receives the credentials so a test can fail one user only.
function stubLogin(impl: (options: LoginOptions) => Promise<TonalClient>): {
  calls: (username?: string) => number;
  restore: () => void;
} {
  const original = TonalClient.create;
  const seen: string[] = [];
  TonalClient.create = (async (options: LoginOptions) => {
    seen.push(options.username);
    return impl(options);
  }) as typeof TonalClient.create;
  return {
    calls: (username) => (username ? seen.filter((u) => u === username).length : seen.length),
    restore: () => { TonalClient.create = original; },
  };
}

const rejectFor = (rejected: string[]) => async ({ username }: LoginOptions): Promise<TonalClient> => {
  if (rejected.includes(username)) {
    throw new TonalClientError('Wrong email or password.', 403);
  }
  return { owner: username } as unknown as TonalClient;
};

const email = (user: string) => `${user}@example.invalid`;

test('a rejected login is not retried against Tonal for five minutes, then is retried', async (t) => {
  mock.timers.enable({ apis: ['Date'], now: 0 });
  const login = stubLogin(rejectFor([email('usera')]));
  t.after(() => { login.restore(); mock.timers.reset(); });

  const service = new TonalService();
  await assert.rejects(service.getClient('usera'), /Wrong email or password/);
  assert.equal(login.calls(), 1);

  mock.timers.tick(REJECTED_LOGIN_RETRY_MS - 1);
  await assert.rejects(service.getClient('usera'), /rejected.*Not retrying for another 1s/s);
  assert.equal(login.calls(), 1, 'still inside the backoff window: no second login attempt');

  mock.timers.tick(1);
  await assert.rejects(service.getClient('usera'), /Wrong email or password/);
  assert.equal(login.calls(), 2, 'backoff expired: exactly one fresh attempt');
});

test('the backoff error is a clear LOGIN_BACKOFF error that survives the tool error handler and leaks no password', async (t) => {
  mock.timers.enable({ apis: ['Date'], now: 0 });
  const login = stubLogin(rejectFor([email('userc')]));
  t.after(() => { login.restore(); mock.timers.reset(); });

  const service = new TonalService();
  await assert.rejects(service.getClient('userc'));
  mock.timers.tick(60_000);
  await assert.rejects(service.getClient('userc'), (error: Error) => {
    assert.match(error.message, /user "userc"/);
    assert.match(error.message, /Not retrying for another 240s/);
    assert.equal((error as TonalMCPError).code, 'LOGIN_BACKOFF');
    const rendered = handleToolError(error, 'get_recent_workouts').content[0] as { text: string };
    assert.match(rendered.text, /LOGIN_BACKOFF/);
    assert.match(rendered.text, /Not retrying for another 240s/, 'handler must not replace the message with a generic one');
    assert.doesNotMatch(error.message, /fake-userc/);
    return true;
  });
});

test('backoff is per user: one rejected login never locks out the other two', async (t) => {
  mock.timers.enable({ apis: ['Date'], now: 0 });
  const login = stubLogin(rejectFor([email('userb')]));
  t.after(() => { login.restore(); mock.timers.reset(); });

  const service = new TonalService();
  await assert.rejects(service.getClient('userb'), /Wrong email or password/);

  const usera = await service.getClient('usera');
  const userc = await service.getClient('userc');
  assert.deepEqual(usera, { owner: email('usera') });
  assert.deepEqual(userc, { owner: email('userc') });

  // userb stays blocked, the others keep serving from cache.
  await assert.rejects(service.getClient('userb'), /Not retrying/);
  assert.equal(await service.getClient('usera'), usera);
  assert.equal(await service.getClient('userc'), userc);
  assert.equal(login.calls(email('userb')), 1);
  assert.equal(login.calls(email('usera')), 1);
  assert.equal(login.calls(email('userc')), 1);
});

test("one user's rejected login does not start or reset another user's cooldown", async (t) => {
  mock.timers.enable({ apis: ['Date'], now: 0 });
  const login = stubLogin(rejectFor([email('usera'), email('userc')]));
  t.after(() => { login.restore(); mock.timers.reset(); });

  const service = new TonalService();
  await assert.rejects(service.getClient('usera'));
  mock.timers.tick(4 * 60 * 1000);
  await assert.rejects(service.getClient('userc')); // userc's clock starts at 4:00

  mock.timers.tick(60 * 1000); // usera at 5:00, userc at 1:00
  await assert.rejects(service.getClient('usera'), /Wrong email or password/);
  assert.equal(login.calls(email('usera')), 2, 'usera cooldown expired on its own clock');
  await assert.rejects(service.getClient('userc'), /Not retrying/);
  assert.equal(login.calls(email('userc')), 1, 'userc is still cooling down');
});

test('different casing of a user name shares the same backoff', async (t) => {
  mock.timers.enable({ apis: ['Date'], now: 0 });
  const login = stubLogin(rejectFor([email('usera')]));
  t.after(() => { login.restore(); mock.timers.reset(); });

  const service = new TonalService();
  await assert.rejects(service.getClient('usera'));
  await assert.rejects(service.getClient('UserA'), /Not retrying/);
  await assert.rejects(service.getClient('USERA'), /Not retrying/);
  assert.equal(login.calls(), 1);
});

test('a successful login clears the rejected state', async (t) => {
  mock.timers.enable({ apis: ['Date'], now: 0 });
  let rejected = true;
  const login = stubLogin(async ({ username }) => {
    if (rejected) throw new TonalClientError('Wrong email or password.', 403);
    return { owner: username } as unknown as TonalClient;
  });
  t.after(() => { login.restore(); mock.timers.reset(); });

  const service = new TonalService();
  await assert.rejects(service.getClient('usera'));
  rejected = false; // password fixed
  mock.timers.tick(REJECTED_LOGIN_RETRY_MS);
  const client = await service.getClient('usera');
  assert.deepEqual(client, { owner: email('usera') });
  assert.equal(await service.getClient('usera'), client, 'cached after success');
  assert.equal(login.calls(), 2);

  const state = service as unknown as { rejectedLogins: Map<string, unknown> };
  assert.equal(state.rejectedLogins.has('USERA'), false, 'no stale backoff entry remains');
});

test('concurrent calls during the backoff fail fast without hitting the API', async (t) => {
  mock.timers.enable({ apis: ['Date'], now: 0 });
  const login = stubLogin(rejectFor([email('usera')]));
  t.after(() => { login.restore(); mock.timers.reset(); });

  const service = new TonalService();
  await assert.rejects(service.getClient('usera'));
  mock.timers.tick(1_000);

  const burst = await Promise.allSettled(Array.from({ length: 25 }, () => service.getClient('usera')));
  assert.equal(burst.length, 25);
  for (const result of burst) {
    assert.equal(result.status, 'rejected');
    assert.match((result as PromiseRejectedResult).reason.message, /Not retrying for another 299s/);
  }
  assert.equal(login.calls(), 1, 'the burst never reached TonalClient.create');
});

test('concurrent first calls share one login, and later calls reuse it', async (t) => {
  const client = {} as TonalClient;
  // Promise.withResolvers is ES2024; the project targets ES2022.
  let finishLogin!: (client: TonalClient) => void;
  const pending = new Promise<TonalClient>((resolve) => { finishLogin = resolve; });
  const login = stubLogin(() => pending);
  t.after(() => login.restore());

  const service = new TonalService();
  const all = Promise.all([service.getClient('usera'), service.getClient('usera'), service.getClient('Usera')]);
  finishLogin(client);
  for (const result of await all) {
    assert.equal(result, client);
  }
  assert.equal(await service.getClient('usera'), client);
  assert.equal(login.calls(), 1);
});

test('concurrent logins for different users are not merged', async (t) => {
  const login = stubLogin(async ({ username }) => ({ owner: username }) as unknown as TonalClient);
  t.after(() => login.restore());

  const service = new TonalService();
  const [usera, userc] = await Promise.all([service.getClient('usera'), service.getClient('userc')]);
  assert.deepEqual(usera, { owner: email('usera') });
  assert.deepEqual(userc, { owner: email('userc') });
  assert.equal(login.calls(), 2);
});

test('concurrent calls that all hit a rejected login share one attempt and all fail', async (t) => {
  mock.timers.enable({ apis: ['Date'], now: 0 });
  const login = stubLogin(rejectFor([email('usera')]));
  t.after(() => { login.restore(); mock.timers.reset(); });

  const service = new TonalService();
  const results = await Promise.allSettled([service.getClient('usera'), service.getClient('usera'), service.getClient('usera')]);
  assert.deepEqual(results.map((r) => r.status), ['rejected', 'rejected', 'rejected']);
  assert.equal(login.calls(), 1);
  await assert.rejects(service.getClient('usera'), /Not retrying/);
  assert.equal(login.calls(), 1);
});

test('a network or server failure is retried on the next call (no backoff)', async (t) => {
  let failure: Error = new TypeError('fetch failed');
  const login = stubLogin(async () => { throw failure; });
  t.after(() => login.restore());

  const service = new TonalService();
  await assert.rejects(service.getClient('usera'), /fetch failed/);
  failure = new TonalClientError('Service unavailable', 503);
  await assert.rejects(service.getClient('usera'), /Service unavailable/);
  assert.equal(login.calls(), 2);
});

test('missing credentials fail without a login attempt or a backoff', async (t) => {
  const login = stubLogin(async () => ({}) as TonalClient);
  t.after(() => login.restore());

  const service = new TonalService();
  await assert.rejects(service.getClient('nobody'), /TONAL_USERNAME_NOBODY and TONAL_PASSWORD_NOBODY/);
  await assert.rejects(service.getClient('nobody'), /TONAL_USERNAME_NOBODY and TONAL_PASSWORD_NOBODY/);
  assert.equal(login.calls(), 0);
});
