import { describe, expect, it, vi } from "vitest";
import { runInNewContext } from "node:vm";
import { NinebotClientError } from "./app-client.js";
import { SmsCodeFlow } from "./sms-verification.js";
import {
  isSmsVerificationResource,
  createSmsVerificationPage,
  smsVerificationCsp,
} from "./sms-verification-page.js";

const challenge = () => new NinebotClientError("Verification required", "verification");
const input = { areaCode: "86", phone: "15500000000", requestId: "request-1" };
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
};

describe("SMS human verification flow", () => {
  it("sends directly when verification is not required", async () => {
    const requestCode = vi.fn().mockResolvedValue(undefined);
    const present = vi.fn();
    await expect(
      new SmsCodeFlow({ requestCode, canVerify: true }).request(1, input, present),
    ).resolves.toEqual({ sent: true });
    expect(present).not.toHaveBeenCalled();
    expect(requestCode).toHaveBeenCalledExactlyOnceWith(
      input.phone,
      input.areaCode,
      undefined,
      expect.any(AbortSignal),
    );
  });

  it("resends once with the completed verification and never reuses it", async () => {
    const requestCode = vi.fn().mockRejectedValueOnce(challenge()).mockResolvedValue(undefined);
    const present = vi.fn().mockResolvedValue("synthetic-validate");
    const flow = new SmsCodeFlow({ requestCode, canVerify: true });
    await expect(flow.request(1, input, present)).resolves.toEqual({ sent: true });
    expect(requestCode).toHaveBeenNthCalledWith(
      2,
      input.phone,
      input.areaCode,
      "synthetic-validate",
      expect.any(AbortSignal),
    );
    await flow.request(1, input, present);
    expect(requestCode).toHaveBeenNthCalledWith(
      3,
      input.phone,
      input.areaCode,
      undefined,
      expect.any(AbortSignal),
    );
    expect(present).toHaveBeenCalledTimes(1);
  });

  it("does not loop when the server rejects a verification result", async () => {
    const requestCode = vi.fn().mockRejectedValue(challenge());
    const present = vi.fn().mockResolvedValue("synthetic-validate");
    await expect(
      new SmsCodeFlow({ requestCode, canVerify: true }).request(1, input, present),
    ).rejects.toMatchObject({ kind: "verification" });
    expect(requestCode).toHaveBeenCalledTimes(2);
    expect(present).toHaveBeenCalledTimes(1);
  });

  it("does not retry non-challenge failures or open a popup in legacy mode", async () => {
    const present = vi.fn();
    await Promise.all(
      [new NinebotClientError("offline", "upstream"), challenge()].map(async (error) => {
        const requestCode = vi.fn().mockRejectedValue(error);
        await expect(
          new SmsCodeFlow({ requestCode, canVerify: false }).request(1, input, present),
        ).rejects.toBeInstanceOf(NinebotClientError);
        expect(requestCode).toHaveBeenCalledTimes(1);
      }),
    );
    expect(present).not.toHaveBeenCalled();
  });

  it("cancels before a late initial challenge can open a popup", async () => {
    const initial = deferred<void>();
    const requestCode = vi.fn(() => initial.promise);
    const present = vi.fn();
    const flow = new SmsCodeFlow({ requestCode, canVerify: true });
    const request = flow.request(1, input, present);
    flow.cancel(1, input.requestId);
    await expect(request).resolves.toEqual({ sent: false, cancelled: true });
    initial.reject(challenge());
    await Promise.resolve();
    expect(present).not.toHaveBeenCalled();
  });

  it("cancels a challenge promptly, even if the presenter ignores abort", async () => {
    const validation = deferred<string>();
    const entered = deferred<void>();
    const requestCode = vi.fn().mockRejectedValue(challenge());
    const flow = new SmsCodeFlow({ requestCode, canVerify: true });
    const request = flow.request(1, input, () => {
      entered.resolve();
      return validation.promise;
    });
    await entered.promise;
    flow.cancel(1, input.requestId);
    await expect(request).resolves.toEqual({ sent: false, cancelled: true });
    validation.resolve("late-validate");
    await Promise.resolve();
    expect(requestCode).toHaveBeenCalledTimes(1);
  });

  it("replaces only the same owner's attempt and ignores mismatched cancellation", async () => {
    const wait = deferred<void>();
    const requestCode = vi.fn(() => wait.promise);
    const flow = new SmsCodeFlow({ requestCode, canVerify: true });
    const first = flow.request(1, input, vi.fn());
    const other = flow.request(2, input, vi.fn());
    const next = flow.request(1, { ...input, requestId: "request-2" }, vi.fn());
    await expect(first).resolves.toEqual({ sent: false, cancelled: true });
    flow.cancel(1, input.requestId);
    wait.resolve();
    await expect(next).resolves.toEqual({ sent: true });
    await expect(other).resolves.toEqual({ sent: true });
  });

  it("does not send on user cancellation or an invalid result", async () => {
    await Promise.all(
      [null, "", " ", "v".repeat(4097)].map(async (validate) => {
        const requestCode = vi.fn().mockRejectedValue(challenge());
        const attempt = new SmsCodeFlow({ requestCode, canVerify: true }).request(
          1,
          input,
          async () => validate,
        );
        if (validate === null)
          await expect(attempt).resolves.toEqual({ sent: false, cancelled: true });
        else await expect(attempt).rejects.toMatchObject({ kind: "verification" });
        expect(requestCode).toHaveBeenCalledTimes(1);
      }),
    );
  });
});

describe("verification page boundary", () => {
  it("shows only bounded failure codes and attempt counts, and completes only on a valid result", () => {
    const elements = new Map<
      string,
      { hidden: boolean; textContent: string; onclick?: () => void }
    >();
    const getElementById = (id: string) => {
      if (!elements.has(id)) elements.set(id, { hidden: true, textContent: "" });
      return elements.get(id)!;
    };
    let onVerify!: (error: unknown, result?: { validate: string }) => void;
    const complete = vi.fn();
    const fail = vi.fn();
    const cancel = vi.fn();
    const verify = vi.fn();
    let onClose!: () => void;
    const pageScript = createSmsVerificationPage("qa-nonce").match(
      /<script nonce="qa-nonce">([\s\S]*?)<\/script>/,
    )![1]!;
    runInNewContext(pageScript, {
      document: {
        getElementById,
        createElement: () => ({}),
        head: { appendChild: (script: { onload: () => void }) => script.onload() },
      },
      window: {
        smsVerification: { complete, fail, cancel },
        initNECaptcha: (
          options: { onVerify: typeof onVerify; onReady: () => void; onClose: () => void },
          loaded: (instance: { verify: () => void }) => void,
        ) => {
          onVerify = options.onVerify;
          onClose = options.onClose;
          loaded({
            verify: () => {
              verify();
              options.onReady();
            },
          });
        },
      },
      setTimeout: vi.fn(),
      clearTimeout: vi.fn(),
    });
    expect(verify).toHaveBeenCalledOnce();
    onVerify({
      code: 200,
      message: "private-provider-text",
      data: { errorCode: "403", validate: "private-token" },
    });
    const feedback = getElementById("verification-feedback");
    expect(feedback.hidden).toBe(false);
    expect(feedback.textContent).toContain("200 / 403");
    expect(feedback.textContent).not.toMatch(/private/);
    onVerify({ code: "private-token" });
    expect(feedback.textContent).toContain("组件未提供错误码");
    onVerify(null);
    expect(feedback.textContent).toContain("已失败 3 次");
    expect(feedback.textContent).toContain("避免反复尝试");
    expect(complete).not.toHaveBeenCalled();
    expect(fail).not.toHaveBeenCalled();
    onVerify(null, { validate: "synthetic-validated" });
    expect(complete).toHaveBeenCalledExactlyOnceWith("synthetic-validated");
    expect(feedback.hidden).toBe(true);
    onClose();
    expect(cancel).toHaveBeenCalledOnce();
  });
  it("allows only HTTPS provider resource families, never local or lookalike hosts", () => {
    expect(isSmsVerificationResource("https://cstaticdun.126.net/load.min.js")).toBe(true);
    for (const url of [
      "https://126.net.evil.test/script",
      "https://evil126.net/",
      "http://c.dun.163.com/",
      "file:///tmp/a",
      "http://127.0.0.1/",
      "https://user@c.dun.163.com/",
    ])
      expect(isSmsVerificationResource(url)).toBe(false);
  });
  it("exposes no app bridge and prevents frames, form submissions and inline scripts without nonce", () => {
    const page = createSmsVerificationPage("qa-nonce");
    expect(page).not.toContain("window.ninebot");
    expect(page).toContain('nonce="qa-nonce"');
    const csp = smsVerificationCsp("qa-nonce");
    expect(csp).toContain("frame-src 'none'");
    expect(csp).toContain("form-action 'none'");
    expect(csp).not.toContain("script-src 'unsafe-inline'");
  });
});
