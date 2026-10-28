import { describe, expect, it, vi } from "vitest";
import { ipcChannels } from "../shared/contracts.js";
import { createDesktopBridge } from "./session-bridge.js";

const expired = { ok: false, error: { code: "AUTH_REQUIRED", message: "重新连接" } };

describe("desktop session bridge", () => {
  it("announces current-session read expiry and removes subscriptions", async () => {
    const invoke = vi.fn(async () => expired);
    const bridge = createDesktopBridge(invoke);
    const listener = vi.fn();
    const unsubscribe = bridge.auth.onSessionExpired(listener);
    await bridge.vehicles.list();
    await bridge.auth.profile();
    expect(listener.mock.calls).toEqual([[], []]);
    unsubscribe();
    await bridge.rides.list({ vehicleId: "synthetic", month: "202610" });
    expect(listener).toHaveBeenCalledTimes(2);
    expect(invoke.mock.calls[0]).toEqual([ipcChannels.listVehicles]);
  });

  it("keeps login rejection and temporary outages distinct from session loss", async () => {
    const invoke = vi.fn(async () => expired);
    const bridge = createDesktopBridge(invoke);
    const listener = vi.fn();
    bridge.auth.onSessionExpired(listener);
    await bridge.auth.passwordLogin({ user: "fake", password: "fake", areaCode: "86" });
    await bridge.auth.requestSmsCode({ phone: "15500000000", areaCode: "86" });
    const requestId = "59d949d8-79cd-4922-b320-92f609bf85b6";
    await bridge.auth.cancelSmsCode({ requestId });
    expect(invoke).toHaveBeenCalledWith(ipcChannels.cancelSmsCode, { requestId });
    invoke.mockResolvedValueOnce({ ok: false, error: { code: "UPSTREAM_ERROR", message: "网络" } });
    await bridge.vehicles.list();
    expect(listener).not.toHaveBeenCalled();
  });

  it("does not let an old pending read reopen login after a new auth attempt", async () => {
    let finish!: (value: unknown) => void;
    const bridge = createDesktopBridge(async (channel) =>
      channel === ipcChannels.listVehicles
        ? new Promise((resolve) => {
            finish = resolve;
          })
        : { ok: true, data: { connected: true } },
    );
    const listener = vi.fn();
    bridge.auth.onSessionExpired(listener);
    const pending = bridge.vehicles.list();
    await bridge.auth.passwordLogin({ user: "fake", password: "fake", areaCode: "86" });
    finish(expired);
    await pending;
    expect(listener).not.toHaveBeenCalled();
  });
});
