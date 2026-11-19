import { join } from "node:path";

export interface ResolveNinebotConfigDirectoryOptions {
  explicitDirectory?: string | undefined;
  userDataDirectory: string;
  sdkDirectoryExists: boolean;
  legacyDirectoryExists: boolean;
}

/**
 * Chooses the ninecli-owned data directory while preserving an existing legacy session once.
 * An explicit directory always wins, which keeps protocol replay and QA deterministic.
 */
export const resolveNinebotConfigDirectory = ({
  explicitDirectory,
  userDataDirectory,
  sdkDirectoryExists: _sdkDirectoryExists,
  legacyDirectoryExists,
}: ResolveNinebotConfigDirectoryOptions) => {
  if (explicitDirectory?.trim()) return explicitDirectory;
  if (legacyDirectoryExists) return join(userDataDirectory, "ninecli");
  return join(userDataDirectory, "ninebot");
};
