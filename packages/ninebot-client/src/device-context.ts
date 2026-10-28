/** Non-secret device metadata used to shape Android-compatible requests. */
export interface NinebotDeviceContext {
  deviceId: string;
  region: string;
  osVersion: string;
  osModel: string;
}

export interface NinebotDeviceContextStore {
  load(): Promise<NinebotDeviceContext>;
  save(context: NinebotDeviceContext): Promise<void>;
  clear(): Promise<void>;
}
