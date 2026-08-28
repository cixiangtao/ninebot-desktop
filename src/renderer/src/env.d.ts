/// <reference types="vite/client" />

import type { NinebotBridge } from "../../shared/contracts";

declare global {
  interface Window {
    ninebot?: NinebotBridge;
  }
}

export {};
