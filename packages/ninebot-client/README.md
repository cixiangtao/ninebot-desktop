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
It does not implement account login, vehicle control, data persistence, or
server-side credential storage. Callers must obtain credentials through an
authorized flow and keep them out of source control and logs.

## Build

From the repository root:

```sh
pnpm --filter @jiuhao/ninebot-client build
```

The generated declaration and JavaScript files are written to this package's
`dist/` directory. The package is not published by the current release
workflow.

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
