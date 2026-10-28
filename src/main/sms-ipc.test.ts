import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { ipcChannels, type BridgeResult } from "../shared/contracts.js";
import { NinebotClientError, type NinebotAppClient } from "./app-client.js";
import { registerIpcHandlers } from "./ipc.js";

const handlers = vi.hoisted(
  () => new Map<string, (...args: unknown[]) => Promise<BridgeResult<unknown>>>(),
);
vi.mock("electron", () => ({
  ipcMain: {
    handle: (name: string, handler: (...args: unknown[]) => Promise<BridgeResult<unknown>>) =>
      handlers.set(name, handler),
  },
  BrowserWindow: {},
  dialog: {},
}));
vi.mock("./sms-verification-window.js", () => ({ presentSmsVerification: vi.fn() }));

class Sender extends EventEmitter {
  constructor(readonly id: number) {
    super();
  }
}
const input = {
  areaCode: "86",
  phone: "15500000000",
  requestId: "59d949d8-79cd-4922-b320-92f609bf85b6",
};
const otherRequestId = "43f28281-6011-43a5-a615-20639ab6a40b";
const invoke = (sender: Sender, channel: string, value?: unknown) =>
  handlers.get(channel)!({ sender }, value);
const clientWith = (requestSmsCode: NinebotAppClient["requestSmsCode"]): NinebotAppClient => ({
  supportsSmsVerification: true,
  requestSmsCode,
  login: async () => {},
  loginWithSmsCode: async () => {},
  logout: async () => {},
  whoami: async () => ({}),
  vehicles: async () => [],
  vehicleStatus: async () => ({}),
  battery: async () => ({}),
  rides: async () => ({}),
  rideDetail: async () => ({}),
  diagnostics: vi.fn(),
});
const challenge = () => new NinebotClientError("complete verification", "verification");

/** The fake presenter waits for user action or cancellation without loading remote content. */
const verificationGate = () => {
  let finish!: (value: string | null) => void;
  let entered!: () => void;
  const ready = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const presenter = vi.fn(async (_owner: unknown, signal: AbortSignal) => {
    entered();
    return new Promise<string | null>((resolve) => {
      finish = resolve;
      if (signal.aborted) resolve(null);
      else signal.addEventListener("abort", () => resolve(null), { once: true });
    });
  });
  return { ready, presenter, finish: (value: string | null) => finish(value) };
};

describe("SMS verification IPC ownership and cancellation", () => {
  it("passes verified results to the SDK without exposing them in IPC responses", async () => {
    const send = vi.fn<NinebotAppClient["requestSmsCode"]>(async (_phone, _areaCode, validate) => {
      if (!validate) throw challenge();
    });
    const client = clientWith(send);
    const presenter = vi.fn(async () => "private-validation-result");
    registerIpcHandlers(client, client, client, client, { smsVerificationPresenter: presenter });
    const result = await invoke(new Sender(1), ipcChannels.requestSmsCode, input);
    expect(result).toEqual({ ok: true, data: { sent: true } });
    expect(send.mock.calls).toEqual([
      [input.phone, input.areaCode, undefined, expect.any(AbortSignal)],
      [input.phone, input.areaCode, "private-validation-result", expect.any(AbortSignal)],
    ]);
    expect(send.mock.calls[0]![3]).toBe(send.mock.calls[1]![3]);
    expect(JSON.stringify(result)).not.toContain("private-validation-result");
  });

  it("only lets the same sender cancel its matching request", async () => {
    const send = vi.fn(async () => {
      throw challenge();
    });
    const client = clientWith(send);
    const gate = verificationGate();
    registerIpcHandlers(client, client, client, client, {
      smsVerificationPresenter: gate.presenter,
    });
    const sender = new Sender(1);
    const pending = invoke(sender, ipcChannels.requestSmsCode, input);
    await gate.ready;
    const signal = gate.presenter.mock.calls[0]![1];
    await invoke(new Sender(2), ipcChannels.cancelSmsCode, { requestId: input.requestId });
    expect(signal.aborted).toBe(false);
    await invoke(sender, ipcChannels.cancelSmsCode, { requestId: otherRequestId });
    expect(signal.aborted).toBe(false);
    await invoke(sender, ipcChannels.cancelSmsCode, { requestId: input.requestId });
    expect(signal.aborted).toBe(true);
    gate.finish("late-validation-result");
    expect(await pending).toEqual({ ok: true, data: { sent: false, cancelled: true } });
    expect(send).toHaveBeenCalledOnce();
  });

  it.each(["destroy", "reload", "crash", "logout", "password", "sms"] as const)(
    "cancels pending verification on %s",
    async (action) => {
      const send = vi.fn(async () => {
        throw challenge();
      });
      const client = clientWith(send);
      const gate = verificationGate();
      registerIpcHandlers(client, client, client, client, {
        smsVerificationPresenter: gate.presenter,
      });
      const sender = new Sender(1);
      const pending = invoke(sender, ipcChannels.requestSmsCode, input);
      await gate.ready;
      if (action === "destroy") sender.emit("destroyed");
      if (action === "reload")
        sender.emit("did-start-navigation", {}, "ninebot-desktop://app/index.html", false, true);
      if (action === "crash") sender.emit("render-process-gone");
      if (action === "logout") await invoke(sender, ipcChannels.authLogout);
      if (action === "password")
        await invoke(sender, ipcChannels.passwordLogin, {
          areaCode: "86",
          user: "synthetic",
          password: "synthetic",
        });
      if (action === "sms")
        await invoke(sender, ipcChannels.smsCodeLogin, { ...input, code: "123456" });
      expect(await pending).toEqual({ ok: true, data: { sent: false, cancelled: true } });
      expect(send).toHaveBeenCalledOnce();
    },
  );

  it("rejects malformed cancellation identifiers", async () => {
    const client = clientWith(async () => {});
    registerIpcHandlers(client);
    expect(
      await invoke(new Sender(1), ipcChannels.cancelSmsCode, { requestId: "bad" }),
    ).toMatchObject({
      ok: false,
      error: { code: "INVALID_INPUT" },
    });
  });
});
