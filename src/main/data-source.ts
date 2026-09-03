export type CandidateSourceDomain = "vehicle" | "telemetry" | "travel";
export type CandidateSource = "candidate" | "ninecli";

type SourceEnvironment = Readonly<Record<string, string | undefined>>;

/**
 * Resolves the migration source for one domain. A domain-specific value wins
 * over the umbrella switch so a single capability can remain on ninecli.
 */
export const isCandidateSourceEnabled = (
  environment: SourceEnvironment,
  domain: CandidateSourceDomain,
): boolean => {
  const domainValue = environment[`NINEBOT_${domain.toUpperCase()}_SOURCE`];
  if (domainValue !== undefined) return domainValue === "candidate";
  // The TypeScript SDK is the primary implementation. Set NINEBOT_SOURCE=ninecli
  // only when a migration investigation explicitly needs the legacy oracle.
  return environment.NINEBOT_SOURCE !== "ninecli";
};

/** Resolves the renderer-safe source label for one domain. */
export const resolveCandidateSource = (
  environment: SourceEnvironment,
  domain: CandidateSourceDomain,
): CandidateSource => (isCandidateSourceEnabled(environment, domain) ? "candidate" : "ninecli");
