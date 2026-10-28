import { contextBridge, ipcRenderer } from "electron";

// This window loads external verification code. Never expose the application's
// account/data bridge, arbitrary IPC, or credentials to it.
contextBridge.exposeInMainWorld("smsVerification", {
  complete: (validate: unknown) => {
    if (typeof validate === "string" && validate.trim() && validate.length <= 4096)
      ipcRenderer.send("ninebot:sms-verification:result", { type: "complete", validate });
  },
  cancel: () => ipcRenderer.send("ninebot:sms-verification:result", { type: "cancel" }),
  fail: () => ipcRenderer.send("ninebot:sms-verification:result", { type: "failed" }),
});
