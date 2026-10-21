import { execFileSync, type ExecFileSyncOptions } from "node:child_process";

/** Use pnpm's JS entry on Windows instead of executing a .cmd file or invoking a shell. */
export const pnpmCommand = (
  args: string[],
  platform = process.platform,
  script = process.env.npm_execpath,
) => {
  if (script && /(?:^|[/\\])pnpm\.(?:cjs|js)$/.test(script))
    return { executable: process.execPath, args: [script, ...args] };
  if (platform === "win32") throw new Error("Run this build through pnpm run on Windows");
  return { executable: "pnpm", args };
};
export const runPnpm = (args: string[], options: ExecFileSyncOptions) => {
  const command = pnpmCommand(args);
  execFileSync(command.executable, command.args, options);
};
