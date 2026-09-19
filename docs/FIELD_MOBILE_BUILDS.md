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

## 7. The build capability audit (Go-Live readiness wave)

Checked on the machine this repository is developed on, **18 September 2026**. Nothing is assumed:
each row is the result of running the command in the last column.

| Capability | Status | Blocking? | Owner action | Exact next command |
|---|---|---|---|---|
| **Expo account** | **absent** — `~/.expo/state.json` holds a device uuid and no session | **yes**, for any EAS build | Create an Expo account (free) | `npx eas-cli login` |
| **EAS CLI** | **not installed** | yes | — (installed on demand) | `pnpm add -g eas-cli` |
| **EAS project** | **not linked** — `expo.extra.eas.projectId` and `expo.owner` are both unset in `app.json` | yes | Link once the account exists | `cd apps/field && npx eas-cli init` |
| **Apple Developer account** | **unknown to this machine**; no credential and no Xcode to use one | yes, for iOS only | $99/year, the owner's own identity and payment | — |
| **Google Play account** | **unknown to this machine** | **no** for UAT — an internal APK needs no Play account | $25 once, when publishing | — |
| **Android SDK** | **absent** — `ANDROID_HOME` unset, no `~/Library/Android/sdk`, `adb` not on the path | yes, for a *local* build. **No** for an EAS cloud build | Either install the SDK, or use EAS and skip it | `brew install --cask android-commandlinetools` |
| **JDK** | **absent** — "Unable to locate a Java Runtime" | same as above | Install a JDK 17+ | `brew install --cask temurin@17` |
| **Xcode** | **absent** — only Command Line Tools; `xcodebuild` refuses | yes, for a local iOS build or the Simulator | Install Xcode from the App Store (~15 GB) | `xcode-select --install` then full Xcode |
| **Android handset** | **none detectable** — `adb` is not installed, so none can be enumerated | **yes, for UAT** | Provide a real Android phone | `adb devices` |
| **iPhone** | **none detectable** | no — iOS does not block Android field validation | — | — |
| **JS bundle for both platforms** | **works** — verified 18 Sep 2026 | no | — | `cd apps/field && pnpm bundle` |

### What this adds up to

**No Android build can be produced today**, by either route:

- **via EAS** — no Expo account, so no project to build in;
- **locally** — no Android SDK and no JDK.

Both are fixable, and the EAS route is the cheaper one: an Expo account is free, the build happens
in their cloud, and neither the SDK nor a JDK is needed on this machine. **That is the recommended
path**, and §4 already describes it.

The only step that is genuinely unavoidable and not ours is the **handset**. A build can be produced
without one; the UAT cannot be run without one.

### Android first, and why iOS waiting is acceptable

An **internal APK is enough to validate the field system** — offline capture, sync idempotency,
photographs, the correction revisit. It needs no Play account, no store review and no submission.
iOS needs an Apple account *and* a Mac with full Xcode, and gives no additional confidence about
whether the offline protocol works.

So the order is: Expo account → `eas init` → `eas build -p android --profile staging` → install the
APK → run `FIELD_MOBILE_OFFLINE_UAT.md` on a real phone. iOS follows whenever the account exists.

**Neither path submits anything to a store**, and this wave attempted no submission.

## 8. Activation attempt — Operational Wave B (18 September 2026)

An attempt to produce an internal Android build, and what it found. **No build was produced**, for
one reason and one reason only: nobody is signed in to an Expo account.

### What is ready, verified rather than assumed

| | State |
|---|---|
| `eas.json` staging profile | **correct** — `distribution: "internal"` and `android.buildType: "apk"`, which is what produces an installable APK rather than an AAB |
| Android package / iOS bundle / scheme | **stable** — `ec.eiastudio.field`, `eiafield`. Unchanged and not to be renamed |
| `expo-sqlite` with `useSQLCipher: true` | **present.** Without it the native build would ship a plain SQLite, `PRAGMA key` would silently do nothing, and the application would refuse to open its database on first run (ADR-028) |
| `expo-location`, `expo-image-picker` (`photosPermission: false`), `expo-secure-store` | present, with permission copy in both languages |
| Android permissions | `ACCESS_COARSE_LOCATION`, `ACCESS_FINE_LOCATION`, `CAMERA` |
| Field Sync protocol | **v3**, which the server speaks |
| `eiafield://` trusted by Better Auth | **yes, automatically** — `apps/web/lib/trusted-origins.ts` adds the first-party scheme, so `AUTH_TRUSTED_ORIGINS` being unset on Preview is not a problem |
| JS bundle for both platforms | builds (`pnpm bundle`) |

### What is missing

| | State |
|---|---|
| EAS CLI | not installed |
| Expo account | **not signed in** — `~/.expo/state.json` holds a device uuid and no session |
| `extra.eas.projectId` / `expo.owner` | **not set**, which is what `eas init` writes |

### OWNER ACTION — Expo authentication

**A free Expo account is sufficient.** Verified against Expo's own documentation on 18 September
2026: *"EAS Build is available to anyone with an Expo account, regardless of whether you pay for EAS
or use the Free plan."* Internal distribution needs **no Google Play account** — `distribution:
"internal"` produces an APK, and only AAB binaries have to go through the Play Store.

```bash
npm install --global eas-cli     # or: pnpm add -g eas-cli
eas login                        # the one step nobody else can do
cd apps/field && eas init        # creates/links the EAS project, writes extra.eas.projectId
```

**After `eas login` succeeds, everything else can be automated**: linking the project, committing
the (non-secret) project id, producing the build, and recording its id, profile, version and git SHA.
The build itself runs in Expo's cloud, so **neither the Android SDK nor a JDK is needed on this
machine** — which is why this route is recommended over a local build.

```bash
cd apps/field && eas build --platform android --profile staging
```

**Do not run `eas submit`.** Store submission is out of scope.

## 9. The blocker nobody had connected: staging is behind deployment protection

Found while validating the staging build profile before spending a build, and it would otherwise
have surfaced as *"the app installs and sign-in does nothing"* on a technician's phone.

The staging profile points at the branch alias in `eas.json`. That host answers **302** to
`https://vercel.com/sso-api?...` for **every** path, including `/health`:

```
$ curl -sD - -o /dev/null .../health
HTTP/2 302
location: https://vercel.com/sso-api?url=...
```

This is Vercel **deployment protection**, and it is *deliberate* — `docs/STAGING_OPERATIONS.md` §4
lists "exposing staging publicly" among the things that must never be done, precisely because it
sits behind that protection. A phone has no Vercel session, so **a build pointing at this host
cannot sign in, cannot pull a Field Pack and cannot sync.**

### The options, with what each costs

| | Option | Cost |
|---|---|---|
| a | **Disable deployment protection** on the staging branch alias | Weakens a control that was added on purpose. Staging holds only synthetic data, but it is also where a reviewer signs in |
| b | Vercel **Protection Bypass for Automation** token, sent by the app | **Refused.** That is a shared secret in a React Native bundle, which ADR-028 forbids in as many words: no service token, no signing key, no shared credential. `apps/field/test/bundle-safety.test.ts` would fail it |
| c | A **second deployment alias** for mobile UAT with protection off, pointing at the same staging database | A little setup; keeps the reviewer-facing alias protected. **Recommended for a durable arrangement** |
| d | Run the first UAT against a **development build on the local network** | Free, immediate, and enough for the first pass. `EXPO_PUBLIC_API_URL` in the `development` profile is `http://localhost:3000`, which on a phone means *the phone* — it must be the build machine's LAN address |

**Recommendation**: (d) for the first handset session, because it needs no owner decision and proves
the offline protocol; (c) before the UAT becomes routine. **(b) is not available to us**, and (a) is
the owner's to weigh.

This is recorded as **TD-120** rather than resolved here: changing a deliberate security posture is
not a decision a build script should make.
