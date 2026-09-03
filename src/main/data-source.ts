export type CandidateSourceDomain = "vehicle" | "telemetry" | "travel";
export type CandidateSource = "candidate";

type SourceEnvironment = Readonly<Record<string, string | undefined>>;

/** The packaged application has one data plane: the TypeScript SDK. */
export const isCandidateSourceEnabled = (
  _environment: SourceEnvironment,
  _domain: CandidateSourceDomain,
): boolean => true;

/** Resolves the renderer-safe source label for one domain. */
export const resolveCandidateSource = (
  _environment: SourceEnvironment,
  _domain: CandidateSourceDomain,
): CandidateSource => "candidate";
