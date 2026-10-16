import type { NinebotPassportSession } from "./auth.ts";
import { createBusinessLoginClient } from "./business-login-node.ts";
import { generateNinebotNonce } from "./crypto-node.ts";
import type { NinebotDeviceContext } from "./device-store-node.ts";
import type { NinebotTransport } from "./transport.ts";

/** A failed bootstrap never promotes Passport credentials to a vehicle-ready session. */
export class NinebotBusinessSessionError extends Error {
  constructor(readonly kind: "missing-credentials" | "business" | "invalid-response") {
    super(`Ninebot business session initialization failed: ${kind}`);
    this.name = "NinebotBusinessSessionError";
  }
}

export interface CreateNinebotBusinessSessionInitializerOptions {
  transport: NinebotTransport;
  deviceContext: () => Promise<NinebotDeviceContext>;
  now?: () => number;
  nonceFactory?: () => string;
  rsaPublicKey?: Uint8Array | string;
}

/**
 * Completes the second login stage using the observed Android business protocol.
 * Only the business response's nonempty string `data.uid` establishes identity.
 * Account tokens and raw responses stay inside this call and are never persisted here.
 */
export const createNinebotBusinessSessionInitializer = ({
  transport,
  deviceContext,
  now = Date.now,
  nonceFactory = generateNinebotNonce,
  rsaPublicKey,
}: CreateNinebotBusinessSessionInitializerOptions) => {
  const client = createBusinessLoginClient({
    transport,
    ...(rsaPublicKey === undefined ? {} : { rsaPublicKey }),
  });
  return async (session: NinebotPassportSession): Promise<string> => {
    if (!session.accessToken.trim() || !session.refreshToken?.trim() || !session.uuid?.trim()) {
      throw new NinebotBusinessSessionError("missing-credentials");
    }
    const device = await deviceContext();
    const response = await client.login({
      sys_language: "zh-hans-cn",
      client_ver: "610063322",
      device_id: device.deviceId,
      regionx: device.region,
      language: "zh",
      ostype: "and",
      lang: "zh",
      platform_ver: `${device.osVersion} ${device.osModel}`,
      platform: "android",
      login_country: "CN",
      access_token: session.accessToken,
      uuid: session.uuid,
      token: session.accessToken,
      refresh_token: session.refreshToken,
      region: device.region,
      serviceTime: now(),
      nonce: nonceFactory(),
    });
    if (response.code !== 1 && response.code !== "1") {
      throw new NinebotBusinessSessionError("business");
    }
    const data = response.data;
    if (
      data === null ||
      typeof data !== "object" ||
      Array.isArray(data) ||
      !("uid" in data) ||
      typeof data.uid !== "string" ||
      !data.uid.trim()
    ) {
      throw new NinebotBusinessSessionError("invalid-response");
    }
    return data.uid;
  };
};
