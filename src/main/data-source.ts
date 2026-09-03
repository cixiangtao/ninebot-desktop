export type CandidateSourceDomain = "vehicle" | "telemetry" | "travel";

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
  if (domainValue === "candidate") return true;
  if (domainValue === "ninecli") return false;
  return environment.NINEBOT_SOURCE === "candidate";
};
