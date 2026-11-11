# Tasks

## 1. Fix ValkeyStore contract violations

- [ ] 1.1 server: Change `ValkeyStore.clear()` in
  `src/shared/valkeyStore.js` to spread prefixed keys —
  `await this._client.del(...ks.map(k => this._k(k)))`; verify
  `npm --prefix server test` passes.
- [ ] 1.2 server: Change `ValkeyStore.size()` to
  `async size() { return (await this.keys()).length; }`; verify
  `npm --prefix server test` passes.

## 2. Tests

- [ ] 2.1 server: Update `test/valkeyStore.test.js` — rename the
  V3 test and replace the `size() === 0` quirk assertion with
  `assert.equal(await store.size(), <count>)` before and after
  `clear()`; keep `FakeKvRedis`'s array-tolerant `del`; verify
  `node --test test/valkeyStore.test.js` passes.

## Workflow follow-up

- Archive the change after the project's review requirements are
  satisfied.
