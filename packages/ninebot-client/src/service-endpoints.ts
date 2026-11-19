export const ninebotServiceNames = ["passport", "business", "ebike", "motor", "travel"] as const;
/** Service families exposed through ninecli's independently configurable upstream hosts. */
export type NinebotServiceName = (typeof ninebotServiceNames)[number];

/** Read-only behavior that the TypeScript client will replace before auth or control work. */
export const readOnlyOracleCapabilities = [
  "whoami",
  "vehicles",
  "status",
  "battery",
  "travel-month",
  "travel-detail",
] as const;
export type ReadOnlyOracleCapability = (typeof readOnlyOracleCapabilities)[number];

/** Maps one upstream service family to its ninecli override flag and loopback listener. */
export interface NinebotServiceEndpoint {
  service: NinebotServiceName;
  upstreamOrigin: string;
  overrideFlag: `--${string}`;
  localPort: number;
}

/** Pinned production origins and non-overlapping local ports observed in ninecli 0.1.7. */
export const defaultNinebotServiceEndpoints = [
  {
    service: "passport",
    upstreamOrigin: "https://api-passport-bj.ninebot.com",
    overrideFlag: "--passport-base",
    localPort: 18_101,
  },
  {
    service: "business",
    upstreamOrigin: "https://api-jhcx-v6-bj.ninebot.com",
    overrideFlag: "--biz-host",
    localPort: 18_102,
  },
  {
    service: "ebike",
    upstreamOrigin: "https://ebike.ninebot.com",
    overrideFlag: "--ebike-host",
    localPort: 18_103,
  },
  {
    service: "motor",
    upstreamOrigin: "https://steeldust.ninebot.com",
    overrideFlag: "--motor-host",
    localPort: 18_104,
  },
  {
    service: "travel",
    upstreamOrigin: "https://cn-cbu-gateway.ninebot.com",
    overrideFlag: "--travel-host",
    localPort: 18_105,
  },
] as const satisfies readonly NinebotServiceEndpoint[];
