# Building and distributing EIA Field

> What exists in this repository, and what needs an account somebody has to pay for. Related:
> `docs/FIELD_MOBILE_ARCHITECTURE.md` (ADR-028), `docs/FIELD_MOBILE_OFFLINE_UAT.md` (what a build
> is for), `docs/PRODUCTION_V1_GO_LIVE.md` blocker 3.
>
> **Nothing here submits anything to a store.** No build has been produced, and no Apple or Google
> account has been created or paid for — both are owner actions with lead times this product does
> not control.

## 1. What the application declares about itself

| | Value | Why it is fixed |
|---|---|---|
| Display name | `EIA Field` | what a technician sees under the icon |
| Slug | `eia-field` | the Expo project's name |
| iOS bundle identifier | `ec.eiastudio.field` | **immutable once the first build reaches App Store Connect.** Changing it later means a new application and a new install for every technician |
| Android package | `ec.eiastudio.field` | same, for Google Play |
| URL scheme | `eiafield` | the one origin Better Auth trusts beside the web app's (ADR-028). No wildcard, and no scheme this product does not control |
| Marketing version | `1.0.0` | `expo.version`; what a person reads in the store and in the diagnostics screen |
| iOS build number | `expo.ios.buildNumber` | monotonic per marketing version; `autoIncrement` in the production profile |
| Android versionCode | `expo.android.versionCode` | monotonic across every build ever uploaded; `autoIncrement` in the production profile |
| Encryption declaration | `ITSAppUsesNonExemptEncryption: false` | the app uses SQLCipher through the OS's own crypto and adds no proprietary algorithm; declaring it here avoids a per-submission question whose wrong answer delays a release |

### Version numbering

`1.0.0` is the marketing version and moves when the product does. The **build number** moves on
every build, and `autoIncrement` in the production profile makes that the machine's job rather than
somebody's memory: a rejected upload because the build number was reused is the most common and
most avoidable release failure there is.

A staging build and a production build of the same commit may share a marketing version and must
never share a build number.

## 2. Permission strings, in both languages

iOS shows the `Info.plist` string verbatim at the moment it asks, so it is the one piece of copy a
person reads before deciding. Spanish is in `app.json`; English is `apps/field/locales/en.json`,
declared through `expo.locales`, which is how Expo produces `InfoPlist.strings` per language.

Both say the same three things, because they are the ones ADR-032 committed to:

- the **technician's own** location, at the start of a visit, only when allowed — never a
  household's;
- the camera, for the parcel, the affectation and the access;
- photographs stay on the device and go to the study — **never to the client portal and never to a
  model provider**.

Android's runtime prompt shows the system's own text; the rationale the application renders is in
the message catalogue, and is bilingual for the same reason everything else is (ADR-029).

## 3. Build profiles

`apps/field/eas.json`:

| Profile | Distribution | Channel | Points at | For |
|---|---|---|---|---|
| `development` | internal | `development` | `http://localhost:3000` | a developer's own machine, with the dev client |
| `staging` | internal | `staging` | the staging web deployment | **the physical-handset UAT** of `FIELD_MOBILE_OFFLINE_UAT.md` |
| `production` | store | `production` | a production host that does not exist yet | the eight studies |

`EXPO_PUBLIC_API_URL` is **build-time** configuration, never a settings screen: a field application
that can be repointed from inside itself is one tap away from writing demo answers into a real study
(ADR-028, SECURITY.md §10e).

The production profile's URL is deliberately the literal `https://REPLACE-WITH-PRODUCTION-HOST`.
Production hosting is not decided (`PRODUCTION_V1_GO_LIVE.md` blocker 4), and a plausible-looking
placeholder is how a build ships pointing at the wrong place.

## 4. What an owner has to do, exactly

None of this can be done from this repository, and none of it has been done.

1. **An Expo account** and an EAS project, then `eas init` inside `apps/field`, which writes
   `expo.owner` and `extra.eas.projectId`. EAS has a free tier with a build queue; a paid plan buys
   concurrency, not capability.
2. **An Apple Developer Program membership** (US$99/year, a legal entity, and a D-U-N-S number for
   an organisation account). Then App Store Connect can hold `ec.eiastudio.field`, and EAS can
   manage the signing credentials.
3. **A Google Play Developer account** (US$25 once, plus identity verification). Then the package
   `ec.eiastudio.field` is reserved.
4. **Internal distribution**: TestFlight for iOS, or an internal testing track for Android. This is
   what the physical UAT needs; a store release is not required to run it.

Steps 2 and 3 are the ones with real lead time — identity verification can take days.

## 5. What is deliberately not automated

- **No submission.** `eas submit` is not wired into any script and no CI job builds the app. A store
  upload is an irreversible, account-bound action, and CLAUDE.md rule 20's reasoning applies to a
  store exactly as it does to production.
- **No credentials in the repository.** No signing key, no service-account JSON, no App Store
  Connect API key. EAS manages them in the account, and they never reach a lockfile or an
  environment file here.
- **No over-the-air update channel in use.** The `channel` fields exist so a build is labelled; no
  update is published to one. Pushing JavaScript to a field device without a build is a capability
  worth having deliberately, not by default.

## 6. Status

| | Status |
|---|---|
| Configuration (identifiers, versions, permissions, profiles) | **complete in the repository** |
| Expo/EAS account | **blocked — owner action** |
| Apple Developer Program | **blocked — owner action, paid** |
| Google Play Developer | **blocked — owner action, paid** |
| Development build produced | **no** |
| Physical-handset UAT | **PREPARED, not executed** (`FIELD_MOBILE_OFFLINE_UAT.md`) |
| Store submission | **not attempted, and out of scope for this wave** |
