import { contextBridge, ipcRenderer } from "electron";
import { ipcChannels, type NinebotBridge } from "../shared/contracts.js";

const bridge = {
  auth: {
    status: () => ipcRenderer.invoke(ipcChannels.authStatus),
    profile: () => ipcRenderer.invoke(ipcChannels.authProfile),
    passwordLogin: (input) => ipcRenderer.invoke(ipcChannels.passwordLogin, input),
    requestSmsCode: (input) => ipcRenderer.invoke(ipcChannels.requestSmsCode, input),
    smsCodeLogin: (input) => ipcRenderer.invoke(ipcChannels.smsCodeLogin, input),
    logout: () => ipcRenderer.invoke(ipcChannels.authLogout),
  },
  runtime: {
    security: () => ipcRenderer.invoke(ipcChannels.runtimeSecurity),
  },
  vehicles: {
    list: () => ipcRenderer.invoke(ipcChannels.listVehicles),
    snapshot: (input) => ipcRenderer.invoke(ipcChannels.getVehicleSnapshot, input),
    location: (input) => ipcRenderer.invoke(ipcChannels.getVehicleLocation, input),
  },
  rides: {
    list: (input) => ipcRenderer.invoke(ipcChannels.listRides, input),
    detail: (input) => ipcRenderer.invoke(ipcChannels.getRideDetail, input),
    verifySpeeds: (input) => ipcRenderer.invoke(ipcChannels.verifyRideSpeeds, input),
    export: (input) => ipcRenderer.invoke(ipcChannels.exportRide, input),
    exportMonthSummary: (input) => ipcRenderer.invoke(ipcChannels.exportMonthSummary, input),
    exportYearSummary: (input) => ipcRenderer.invoke(ipcChannels.exportYearSummary, input),
  },
} satisfies NinebotBridge;

contextBridge.exposeInMainWorld("ninebot", bridge);
