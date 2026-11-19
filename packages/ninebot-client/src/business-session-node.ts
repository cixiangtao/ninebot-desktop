import { createNinebotBusinessSessionInitializerCore } from "./business-session-core.ts";
export { NinebotBusinessSessionError } from "./business-session-core.ts";
import { createBusinessLoginClient } from "./business-login-node.ts";
import { generateNinebotNonce } from "./crypto-node.ts";
import type { NinebotDeviceContext } from "./device-context.ts";
import type { NinebotTransport } from "./transport.ts";
export interface CreateNinebotBusinessSessionInitializerOptions {
  transport: NinebotTransport;
  deviceContext: () => Promise<NinebotDeviceContext>;
  now?: () => number;
  nonceFactory?: () => string;
  rsaPublicKey?: Uint8Array | string;
}
/** Node adapter for the shared business-identity bootstrap. */
export const createNinebotBusinessSessionInitializer = ({
  transport,
  rsaPublicKey,
  nonceFactory = generateNinebotNonce,
  ...options
}: CreateNinebotBusinessSessionInitializerOptions) =>
  createNinebotBusinessSessionInitializerCore({
    ...options,
    nonceFactory,
    client: createBusinessLoginClient({
      transport,
      ...(rsaPublicKey === undefined ? {} : { rsaPublicKey }),
    }),
  });
