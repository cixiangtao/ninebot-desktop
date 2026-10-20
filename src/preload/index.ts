import { contextBridge, ipcRenderer } from "electron";
import { createDesktopBridge } from "./session-bridge.js";

contextBridge.exposeInMainWorld(
  "ninebot",
  createDesktopBridge((channel, ...args) => ipcRenderer.invoke(channel, ...args)),
);
