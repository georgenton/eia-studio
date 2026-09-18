# EIA Field — architecture

> The first-party offline capture application for road-EIA technicians. React Native + Expo +
> TypeScript, in the same workspace as everything else. Decision record: **ADR-028**. The wire is
> `docs/OFFLINE_SYNC_PROTOCOL.md`; the acceptance procedure is
> `docs/FIELD_MOBILE_OFFLINE_UAT.md`.

## 1. What it is for

One sentence, and every decision below follows from it:

> A technician must be able to sign in with a signal, drive four hours into a corridor with none,
> capture a day of work, close and reopen the application, submit, come back, synchronise, and
> produce **zero duplicates** — however many times the synchronisation is retried.

Visual polish is not the point of this wave. That invariant is.

## 2. Where it sits

```
apps/field ──┐
             ├── @eia/field-sync-contract   zod wire schemas, both sides
             └── @eia/domain/mobile          the questionnaire's own validation rules
                         │
apps/web  ── /api/field/{pack,sync,pull} ── @eia/application ── @eia/db ── PostgreSQL (RLS)
```

The mobile bundle contains **no** driver, ORM, application code, `node:` builtin or secret. That is
asserted three ways: an ESLint boundary, `apps/field/test/bundle-safety.test.ts`, and
`packages/domain/test/purity.test.ts`, which walks the `@eia/domain/mobile` import graph.

## 3. Versions, and why they are pinned exactly

| | |
|---|---|
| Expo SDK | **57.0.23** |
| React Native | **0.86.3** |
| React | **19.2.3** |
| expo-sqlite | 57.0.3 (SQLCipher via config plugin) |
| expo-secure-store | 57.0.4 |
| Better Auth | 1.7.2 + `@better-auth/expo` 1.7.2 — the version the product already runs |

`apps/field/test/expo-alignment.test.ts` compares every pin against
`expo/bundledNativeModules.json`, the SDK's own statement of what it was built against. It exists
because asking npm for `latest` returned React Native **0.87.1** — a real release, and not the SDK
57 pairing — and the build then failed inside `@expo/metro-config` requiring a file React Native had
removed. Nothing in that stack trace mentioned versions.

Better Auth stays at **1.7.2** deliberately. `@better-auth/expo@1.7.5` would have required bumping
the server to 1.7.5, which drops the `account.issuer` column this schema declares `NOT NULL`;
upgrading the identity system is a change that deserves its own pull request, not a side effect of
adding a client.

## 4. pnpm, Metro and the two settings that matter

```js
config.watchFolders = [workspaceRoot];          // workspace packages are transformed as source
config.resolver.nodeModulesPaths = [app, root]; // pnpm's symlinked store is above the app
config.resolver.unstable_enableSymlinks = true;
config.resolver.disableHierarchicalLookup = false;
```

The last line is the opposite of the advice written for npm/yarn hoisted layouts, and it is
required here: under pnpm a package's own dependencies live *beside it* inside
`.pnpm/<pkg>/node_modules`, so a resolver that consults only the two roots cannot find `invariant`
for `react-native` and fails on React Native's first `require`.

`pnpm-workspace.yaml` also hoists the React Native toolchain publicly (`react-native`,
`@react-native/*`, `metro*`), because `@expo/metro-config` resolves peers by walking up from its own
location without declaring them. The scoped hoist is the standard remedy; `node-linker=hoisted`
would abandon strict resolution for the whole monorepo.

## 5. The local database

`expo-sqlite` with **SQLCipher**, opened with a 32-byte key generated once per installation by the
platform CSPRNG and kept in `expo-secure-store` (Keychain / Android Keystore). Nothing is hard-coded:
a key compiled into a bundle protects against nothing, because the bundle is on the device the
attacker is holding.

`assertEncrypted` asks `PRAGMA cipher_version` after opening and **refuses to continue** if the
answer is empty. On a runtime without the extension — Expo Go, for instance — `PRAGMA key` silently
does nothing, and the application would otherwise store a technician's answers in the clear while
believing it had encrypted them.

Eleven small tables (`apps/field/src/db/migrations.ts`), forward-only, versioned in `mobile_meta`.
The schema is a **capture journal**, not a copy of PostgreSQL: one technician's current work, with
no project, no other technician, no respondents, no findings and no geometry. A phone is lost,
stolen and resold; the blast radius of that event is what this schema chooses to hold.

Two ids per entity: a local `id` from the moment the technician creates the row offline, and a
`server_id` once a command is acknowledged.

## 6. Authentication and the offline window

One identity system (ADR-010). The Expo plugin keeps the session in SecureStore and the three API
routes read it exactly as a page does; authorization is resolved server-side on every call.

A technician must authenticate **online at least once**. The Field Pack then carries a validity
window of `min(session expiry, now + 7 days)`, with a one-hour floor below which a pack is refused
rather than handed over — finding out in a corridor that the window lapsed on arrival is worse than
finding out beside a signal.

**The limitation, stated plainly:** a fully disconnected device cannot learn that an account was
revoked. Revocation takes effect at the next server contact. When the window lapses the application
stops offering new capture and keeps everything already captured, which still syncs.

## 7. Screens

`Iniciar sesión` · `Mi trabajo` · `Predio` · `Ficha` · `Centro de sincronización` · `Ajustes`.

Five screens and a hand-written navigator — a router would be a dependency, a build step and a set
of conventions in exchange for navigation this application expresses as a discriminated union.

The rule the list screen exists to keep: **`Enviada en el dispositivo · pendiente de
sincronización` is not `Sincronizada`.** A technician who has pressed *Enviar* has finished their
part; the server may not hear about it for hours, and blurring those two is how field data quietly
disappears.

Outdoor-readable: 16-point body text, 48-point touch targets, and no state carried by colour alone —
every chip has a word in it.

## 8. What is deliberately not here

| Not built | Why |
|---|---|
| Media capture | there is no `Media` table, no storage adapter and no credential (TD-037). A camera button that stores photographs the product cannot upload is the dishonest half of a feature |
| Background sync | an enhancement, never the correctness mechanism (ADR-028 §consequences). The guaranteed pathways are launch, connectivity returning while open, and the button |
| A correction workflow | a submitted response is immutable by design (invariant 9); reopening one quietly on a phone is exactly what that invariant forbids |
| Any model call | this wave has no AI requirement and no code path to one |
| Bilingual UI | Spanish only, with the language placeholder in `Ajustes` ready for Wave 2 |

## Correction revisits (ADR-038)

A technician can be sent back to a parcel they have already surveyed, when a submitted response
needs correcting. On the device this is an ordinary assignment with one extra fact attached:

```ts
correction: { correctsAssignmentId, reason, requestedAt } | null
```

*Mi trabajo* marks the row **Revisita de corrección**; the assignment screen repeats the chip, shows
a notice saying the previous response is kept and not modified, and prints the reason a coordinator
wrote. Capture proceeds exactly as it does for a first visit — draft, restart, submit, sync — and a
retry produces one response.

Three columns were added to `local_assignment` (local migration 3) and **no answers**: the previous
household's responses stay on the server, where reading them is a permission a technician does not
hold. A phone is lost, stolen and resold, and the blast radius of that event is exactly what this
schema chooses to hold.

There is still **no** way to reopen a submitted response from the device, and `SYNCED` is still
terminal. A correction is a different work item, not a door back into an old one.
