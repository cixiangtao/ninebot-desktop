import { pathToFileURL } from "node:url";
import { net, protocol } from "electron";
import { appProtocolScheme, resolveRendererAssetPath } from "./renderer-path.js";

export { appProtocolEntryUrl, appProtocolRecoveryUrl, appProtocolScheme } from "./renderer-path.js";

/** Registers the packaged renderer as a constrained, web-like custom protocol. */
export const registerAppProtocol = (rendererRoot: string) => {
  protocol.handle(appProtocolScheme, (request) => {
    const assetPath = resolveRendererAssetPath(rendererRoot, request.url, request.method);
    if (!assetPath) return new Response("Not found", { status: 404 });
    return net.fetch(pathToFileURL(assetPath).toString());
  });
};
