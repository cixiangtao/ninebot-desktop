# @jiuhao/ninebot-client

`@jiuhao/ninebot-client` is a read-only TypeScript client for the Ninebot
candidate protocol used by this project. It packages the request construction,
encryption, response decoding, and service routing behind one small session
client so an Electron or Node.js host can provide its own transport.

The current build is Node-oriented: the public candidate entry imports the
Node crypto implementation for AES, RSA, MD5, and secure randomness. A browser
or mobile host cannot import this build directly; it needs a future compatible
crypto provider/build before it can reuse the session client.

The platform-neutral orchestration is available from
`@jiuhao/ninebot-client/candidate-session-core`. It has no Node crypto import:
browser, React Native, and other hosts can inject their own encrypted vehicle,
telemetry, and travel clients while sharing field assembly, request-id
propagation, cancellation, and session cleanup. Hosts without Web Crypto must
also provide a `nonceFactory`.

The package is currently private (`0.0.0`) and is not an official Ninebot SDK.
The `auth` entry now provides a platform-neutral `NinebotAuthSessionManager`,
an async session-store contract, and an injected auth-provider contract. The
manager handles login-result replacement, persistence, expiry-aware refresh,
logout cleanup, and defensive session copies without retaining passwords.
Vehicle control remains out of scope. Callers must keep credentials out of
source control and logs.

Password authentication now has two stages: Passport returns account tokens,
then encrypted `POST /user/user/login` establishes the business UID. Passport
`uid` and `business_uid` fields are never used as the business identity.
`createNinebotPassportAuthProvider` requires an `initializeBusinessSession`
callback and returns a complete session only after both stages succeed. SMS
requests now call the observed Passport send-code/consume-code endpoints with
SHA-256 signing; SMS login uses the same Business bootstrap. A server challenge
is surfaced as a bounded error without claiming that SMS was sent. Embedded
human-challenge interaction is not implemented. See the [phase-one acceptance
checklist](../../docs/AUTH_PHASE1.md); fresh-account online acceptance is pending.

The lifecycle layer can be imported without pulling in Node-only crypto:

```ts
import { NinebotAuthSessionManager } from "@jiuhao/ninebot-client/auth";
```

The Passport client exposes the reconstructed password-login, refresh, and
`whoami` boundaries. The Node entry exports `createNinebotPassportSigner`,
which reconstructs the sorted raw query canonical string and SHA-256 signature
observed in ninecli 0.1.7. `whoami` sends the raw access token in Authorization,
without a `Bearer` prefix. Hosts may inject a signer for protocol tests.

## Node authentication

The new `auth-node` factory composes Passport, encrypted business login, gzip
response decoding, device metadata, and file-backed session management:

```ts
import { createNinebotNodeAuthSessionManager } from "@jiuhao/ninebot-client/auth-node";

const auth = createNinebotNodeAuthSessionManager({
  directory: "/absolute/private/ninebot-sdk",
});

await auth.restore(); // Local files only; this does not verify upstream validity.
await auth.loginWithPassword({
  areaCode: "86",
  user: usernameFromUserInput,
  password: passwordFromUserInput,
});

const session = await auth.ensureSession(); // Refreshes near expiry when available.
// Pass session.accessToken and session.businessUid to authorized read-only clients.
await auth.logout();
```

Use a private, isolated directory for acceptance testing. A successful Passport
response alone is insufficient: business login must return the observed success
code `1` (numeric or string) and a nonempty string `data.uid`. Missing UUID,
business failure, invalid UID, or HTTP failure rejects login without replacing
the previous complete session. Passwords and intermediate Passport sessions are
not written to the session file. Refresh updates account tokens and retains the
business UID from the completed login.

New device contexts use the observed Android protocol defaults (`13`, `Xiaomi`,
region `bj`); existing device metadata is preserved. These values describe the
wire protocol context. `deviceDefaults` affects newly generated contexts only.
The factory accepts partial `origins`, a custom `fetch`, and `timeoutMs` (15 seconds
by default), or an injected `transport` that takes precedence over those options.
`now` controls business service time and expiry checks; Passport timestamps use
the Passport request builder's system clock.

The store writes `auth-session.json` with restricted permissions and can read an
existing complete legacy `tokens.json`. An incomplete legacy session without a
business UID must log in again. Explicit logout removes both token files so a
restart cannot restore the legacy session. Use a separate directory if the
legacy session must remain available to another application. Device metadata is
retained. Concurrent refreshes are shared; superseded login/refresh results
cannot replace a newer account or restore credentials after logout.

This implementation has passed local HTTP integration tests using synthetic
credentials, encrypted responses, and gzip. New-account login and refresh still
need acceptance against the real Ninebot service. The desktop production entry
continues to use ninecli for authentication.

From this repository, `pnpm protocol:auth -- --service=ebike --month=202609`
runs the real-service acceptance flow with terminal credential prompts and a
fresh temporary directory. It checks persisted login/refresh, profile and
read-only service access, then logout restoration and cleanup. Empty vehicle or
ride samples produce an incomplete result. See the repository's
[acceptance guide](../../docs/PROTOCOL_RESEARCH.md#真实-sdk-认证验收) for scope,
exit codes and noninteractive input. This command still requires a real account
run before the new authentication path is eligible for production use.

Password authentication can also be blocked by an interactive upstream check.
The basic request does not implement challenge presentation or submission.
`PassportLoginBusinessError.rejection` and the acceptance report's
`passportRejection` classify explicit server descriptions into bounded categories;
undocumented codes (including `2`) alone remain `unknown`. The error retains no
raw server description or challenge data. A verification requirement needs a
normal interactive integration or a separately authorized existing-session flow;
request parity alone does not establish that a fresh login will succeed.

The private `0.0.0` API changed: Passport login/refresh now return
`NinebotPassportSession` (no business UID), `parsePassportRefreshSession` accepts
the previous Passport session, and `createNinebotPassportAuthProvider` requires
its business initializer options. Complete sessions remain
`NinebotAuthSession`. Custom runtime adapters must supply both login stages.

## Build

From the repository root:

```sh
pnpm --filter @jiuhao/ninebot-client build
pnpm --filter @jiuhao/ninebot-client typecheck:browser
```

The generated declaration and JavaScript files are written to this package's
`dist/` directory. The package is not published by the current release
workflow.

`typecheck:browser` checks the platform-neutral session, auth, Passport, and
web crypto/transport layers against the DOM library without Node-only imports.
It does not make the Node service clients or file stores browser-compatible.

## Minimal usage

The fetch factory uses the validated Ninebot service origins by default. Pass
the session fields supplied by the host application; values below are
placeholders and must not be replaced with real credentials in a committed
file.

```ts
import { createNinebotFetchCandidateSessionClient } from "@jiuhao/ninebot-client/candidate-session";

const client = createNinebotFetchCandidateSessionClient({
  platform: 2,
  session: {
    sys_language: "zh-hans-cn",
    client_ver: "610063322",
    device_id: process.env.NINEBOT_DEVICE_ID!,
    regionx: process.env.NINEBOT_REGION!,
    language: "zh",
    ostype: "and",
    lang: "zh",
    platform_ver: "13 device",
    platform: "android",
    login_country: "CN",
    access_token: process.env.NINEBOT_ACCESS_TOKEN!,
    uid: process.env.NINEBOT_UID!,
  },
});

const status = await client.status({
  service: "ebike",
  serialNumber: "YOUR_SERIAL_NUMBER",
});

// Drop the in-memory session when the account is logged out or changed.
client.clear();
```

`status` and `battery` accept `ebike` or `motor`. `listVehicles` additionally
needs the service's observed `vehicleType`. `month` and `detail` use the
same service and vehicle type, plus a `YYYYMM` month or a travel id.

Every request receives a generated request id and per-request nonce by
default. Tests or protocol fixtures can inject `clock`, `nonceFactory`, and
`requestIdFactory` for deterministic values. A custom `fetch` implementation
or partial `origins` map can be supplied to the fetch factory for a proxy,
test double, or another runtime. `timeoutMs` optionally bounds each request;
the caller can still cancel sooner with `AbortSignal`:

```ts
const client = createNinebotFetchCandidateSessionClient({
  platform: 2,
  session,
  origins: { travel: "https://example.test" },
  fetch: myFetch,
  timeoutMs: 15_000,
});
```

The client keeps the session only in an in-memory closure. Calling `clear()`
cancels in-flight requests and makes all future operations fail closed until a
new client is created.

For a non-Node runtime, compose the same lifecycle around platform-specific
clients:

```ts
import { createNinebotCandidateSessionClientFromClients } from "@jiuhao/ninebot-client/candidate-session-core";

const client = createNinebotCandidateSessionClientFromClients({
  session,
  clients: {
    vehicles: browserVehicleClient,
    telemetry: browserTelemetryClient,
    travel: browserTravelClient,
  },
  nonceFactory: securePlatformNonce,
});
```

The injected clients own encryption and transport details; the core only
assembles the observed plaintext fields and controls the in-memory session
lifecycle.

The `@jiuhao/ninebot-client/crypto-web` subpath now exposes the first
platform-neutral crypto provider primitives: canonical/Android Base64, MD5
checkcodes, Web Crypto AES-CBC, browser-compatible RSAES-PKCS1-v1_5, the
observed four-input response key mixer, and secure random material generation.
AES/RSA functions expose asynchronous APIs; AES requires
`globalThis.crypto.subtle`, while RSA uses Web Crypto randomness and a
BigInt-based public operation because RSAES-PKCS1-v1_5 is not consistently
available in Web Crypto implementations. This is a primitive layer for the
future web/mobile codec, not yet a drop-in replacement for the Node candidate
service clients.

`@jiuhao/ninebot-client/crypto-web-codec` composes those primitives into the
observed encrypted request envelope and response `r`/inner-Base64 decoding
chain. It keeps response key-data bound to the originating request and uses
async methods to match Web Crypto-friendly providers. Service-specific browser
clients and login are still outside this package boundary.

`@jiuhao/ninebot-client/transport-web` provides the matching Fetch boundary
for `ebike`, `motor`, and `travel`: it preserves binary response bytes, passes
through caller cancellation, and can enforce a per-request timeout. It does
not add cookies, login, token persistence, or vehicle-control operations.

All five read-only methods also accept an optional `AbortSignal`. Hosts can
cancel a request when the user switches vehicles or leaves a page:

```ts
const controller = new AbortController();
const pending = client.detail({
  service: "ebike",
  serialNumber: "YOUR_SERIAL_NUMBER",
  vehicleType: 14363,
  travelId: "YOUR_TRAVEL_ID",
  signal: controller.signal,
});

controller.abort();
await pending.catch(() => undefined);
```

## Protocol boundary

This package is intended for personal, authorized, read-only data access and
for compatibility research. It should not be used to bypass account checks,
defeat anti-abuse controls, or send vehicle-control commands. Keep captured
payloads private and redact tokens, device identifiers, serial numbers, and
location data before sharing diagnostics.

## Independent auth-result contract

The platform-neutral `auth-result` subpath observes decoded authentication
responses without retaining tokens or upstream descriptions. Assessment requires
an explicit operation-specific policy; there is no default Business success-code
or partial-session compatibility policy. This module is not wired into the current
authentication client or desktop entry.

The separate `auth-result-reference` subpath models fixed ninecli 0.1.7 and current
TS response behavior for offline comparison only. These references are not
production acceptance rules. See [the contract and evidence boundaries](../../docs/AUTH_RESULT_CONTRACT.md).
