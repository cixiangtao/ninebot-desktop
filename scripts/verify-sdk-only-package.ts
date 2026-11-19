import { resolve } from "node:path";
import { verifySdkOnlyPackage } from "./sdk-only-audit.ts";
const app = process.argv.find((arg) => arg.startsWith("--app="))?.slice(6);
if (!app) throw new Error("Pass an explicit SDK-only --app path");
if (process.platform !== "darwin" && process.platform !== "win32")
  throw new Error("Unsupported SDK package verification host");
console.log(
  JSON.stringify(
    await verifySdkOnlyPackage(resolve(import.meta.dirname, ".."), resolve(app), process.platform),
    null,
    2,
  ),
);
