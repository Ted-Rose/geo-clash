# Memory Store Delta

## MODIFIED Requirements

### Requirement: Async-friendly KV surface

Stores SHALL expose `get`, `set`, `del`, `has`, `keys`, `all`,
`clear`, and `size` as awaitable methods, and consumers MUST
`await` every call — even though the `MemoryStore` impl resolves
synchronously. `clear()` SHALL drain the store's keyspace under
either backend; `size()` SHALL return the live entry count.
Business logic MUST NOT use a bare `Map` for persistent
collections.

#### Scenario: Call site survives a backend swap

- **WHEN** a code path reads `await store.get(key)`
- **THEN** it behaves identically whether the impl is
  `MemoryStore` or `ValkeyStore`

#### Scenario: Clear drains under either backend

- **WHEN** `await store.clear()` runs against a `ValkeyStore`
  holding prefixed keys
- **THEN** every prefixed key is deleted from the backend,
  `await store.keys()` returns `[]`, and foreign-prefix keys are
  untouched — identical to `MemoryStore`

#### Scenario: Size reports the live count

- **WHEN** `await store.size()` runs against a `ValkeyStore`
  holding N prefixed keys
- **THEN** it resolves to N — identical to `MemoryStore.size()`
