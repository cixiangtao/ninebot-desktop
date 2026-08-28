import { isAbsolute, relative, resolve, sep } from "node:path";

export const appProtocolScheme = "qiji";
export const appProtocolEntryUrl = `${appProtocolScheme}://app/index.html`;
export const appProtocolRecoveryUrl = `${appProtocolScheme}://app/recovery.html`;

/**
 * Resolves a renderer request inside the packaged renderer root.
 *
 * @returns A local asset path, or null for another host, method, or a traversal attempt.
 */
export const resolveRendererAssetPath = (
  rendererRoot: string,
  requestUrl: string,
  method = "GET",
) => {
  if (method !== "GET" && method !== "HEAD") return null;

  try {
    const url = new URL(requestUrl);
    if (url.protocol !== `${appProtocolScheme}:` || url.host !== "app") return null;
    const rawPath = decodeURIComponent(requestUrl.split(/[?#]/)[0] ?? "").replaceAll("\\", "/");
    if (rawPath.split("/").includes("..")) return null;
    const pathname = decodeURIComponent(url.pathname);
    const requestedPath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
    const assetPath = resolve(rendererRoot, requestedPath);
    const relativePath = relative(rendererRoot, assetPath);
    const escapesRoot =
      relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath);
    return escapesRoot ? null : assetPath;
  } catch {
    return null;
  }
};
