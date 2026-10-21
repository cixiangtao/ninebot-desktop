/** Build-time selection only; ordinary development and packaging retain legacy defaults. */
export const resolveBuildMode = (value: string | undefined): "legacy" | "sdk-only" => {
  if (value === undefined || value === "legacy") return "legacy";
  if (value === "sdk-only") return "sdk-only";
  throw new Error("Unsupported desktop build mode");
};
