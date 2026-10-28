import { NinebotClientError } from "./app-client.js";
import type { SmsCodeRequestInput, SmsCodeRequestStatus } from "../shared/contracts.js";

interface SmsCodeFlowOptions {
  requestCode: (
    phone: string,
    areaCode: string,
    validate?: string,
    signal?: AbortSignal,
  ) => Promise<void>;
  canVerify: boolean;
}

/** One cancellable send per owning renderer; a challenge can cause at most one retry. */
export class SmsCodeFlow {
  private readonly active = new Map<number, { requestId?: string; controller: AbortController }>();

  constructor(private readonly options: SmsCodeFlowOptions) {}

  cancel(owner: number, requestId?: string) {
    const active = this.active.get(owner);
    if (!active || (requestId !== undefined && requestId !== active.requestId)) return;
    this.active.delete(owner);
    active.controller.abort();
  }

  cancelAll() {
    for (const owner of this.active.keys()) this.cancel(owner);
  }

  async request(
    owner: number,
    input: SmsCodeRequestInput,
    present: (signal: AbortSignal) => Promise<string | null>,
  ): Promise<SmsCodeRequestStatus> {
    this.cancel(owner);
    const controller = new AbortController();
    const active = {
      ...(input.requestId === undefined ? {} : { requestId: input.requestId }),
      controller,
    };
    this.active.set(owner, active);
    const { signal } = controller;
    const cancelled = { sent: false, cancelled: true } as const;
    let onAbort: (() => void) | undefined;
    const aborted = new Promise<typeof cancelled>((resolve) => {
      onAbort = () => resolve(cancelled);
      signal.addEventListener("abort", onAbort, { once: true });
    });
    const send = async (): Promise<SmsCodeRequestStatus> => {
      try {
        await this.options.requestCode(input.phone, input.areaCode, undefined, signal);
      } catch (error) {
        if (signal.aborted) return cancelled;
        if (!(error instanceof NinebotClientError) || error.kind !== "verification") throw error;
        if (!this.options.canVerify)
          throw new NinebotClientError(
            "当前传统运行模式不支持人机验证，请使用 SDK 模式后重新发送验证码。",
            "verification",
          );
        const validate = await present(signal);
        // Changing the destination or closing the form must never send a late retry.
        if (signal.aborted || validate === null) return cancelled;
        if (typeof validate !== "string" || !validate.trim() || validate.length > 4096)
          throw new NinebotClientError(
            "未获取到有效的验证结果，请重新发送验证码。",
            "verification",
          );
        try {
          await this.options.requestCode(input.phone, input.areaCode, validate, signal);
        } catch (retryError) {
          if (signal.aborted) return cancelled;
          if (retryError instanceof NinebotClientError && retryError.kind === "verification")
            throw new NinebotClientError(
              "验证结果未被九号接受，请重新发送验证码并再次完成验证。",
              "verification",
            );
          throw retryError;
        }
      }
      return signal.aborted ? cancelled : { sent: true };
    };
    try {
      return await Promise.race([send(), aborted]);
    } finally {
      if (onAbort) signal.removeEventListener("abort", onAbort);
      if (this.active.get(owner) === active) this.active.delete(owner);
    }
  }
}
