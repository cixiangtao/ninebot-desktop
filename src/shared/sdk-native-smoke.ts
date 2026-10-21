declare const SDK_ONLY_BUILD_FLAG: boolean;
export const sdkOnlyBuild = typeof SDK_ONLY_BUILD_FLAG !== "undefined" && SDK_ONLY_BUILD_FLAG;
export const sdkSmokeChannels = {
  configure: "sdk-only-smoke:configure",
  report: "sdk-only-smoke:report",
  mounted: "sdk-only-smoke:renderer-mounted",
} as const;
