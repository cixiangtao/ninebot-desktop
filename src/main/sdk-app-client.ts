import { classifyProfileFailure, type ProfileFailure } from "./sdk-profile-failure.js";
import {
  PassportLoginBusinessError,
  NinebotAuthSessionUnavailableError,
  NinebotBusinessSessionError,
  NinebotHumanVerificationRequiredError,
  PassportLoginHttpError,
  PassportRefreshMaterialError,
  NinebotPassportRedirectError,
  NinebotHttpError,
  type NinebotAuthSessionManager,
} from "@jiuhao/ninebot-client/node";
import type { RuntimeSecurityStatus } from "../shared/contracts.js";
import { NinebotClientError, type NinebotAppClient } from "./app-client.js";
import type { TravelReader } from "./travel-source.js";
import type { VehicleReader } from "./vehicle-source.js";
import type { VehicleTelemetryReader } from "./vehicle-snapshot.js";

const passportAuthCodes = new Set(["90016", "90017", "90018", "90019", "00002", "00003"]);

/** Converts Passport transport failures to the renderer's stable client error contract. */
export const normalizeSdkAuthError = (error: unknown): NinebotClientError => {
  if (error instanceof NinebotPassportRedirectError)
    return new NinebotClientError(
      "九号认证接口发生重定向，已停止请求，请检查接口配置。",
      "upstream",
    );
  if (error instanceof PassportRefreshMaterialError)
    return new NinebotClientError("当前会话缺少刷新资料，请重新连接九号账号。", "auth");
  if (error instanceof NinebotAuthSessionUnavailableError)
    return new NinebotClientError("请先连接九号账号。", "auth");
  if (error instanceof NinebotHumanVerificationRequiredError)
    return new NinebotClientError(
      "九号要求先完成人机验证；请在官方客户端完成验证后再重试。",
      "verification",
    );
  if (error instanceof PassportLoginBusinessError) {
    if (error.rejection === "human-verification")
      return new NinebotClientError(
        "九号要求先完成人机验证；请在官方客户端完成验证后再重试。",
        "verification",
      );
    if (error.rejection === "invalid-credentials")
      return new NinebotClientError("账号或密码不正确，请检查后重试。", "auth");
    if (error.rejection === "invalid-request")
      return new NinebotClientError("九号未接受认证请求参数，请稍后重试。", "upstream");
    if (error.rejection === "rate-limited")
      return new NinebotClientError("认证请求过于频繁，请稍后重试。", "upstream");
    return new NinebotClientError(
      passportAuthCodes.has(String(error.resultCode))
        ? "登录状态已失效，请重新连接九号账号。"
        : "九号未接受认证请求，请确认登录方式后重试。",
      passportAuthCodes.has(String(error.resultCode)) ? "auth" : "upstream",
    );
  }
  if (error instanceof NinebotBusinessSessionError)
    return new NinebotClientError(
      error.kind === "missing-credentials"
        ? "认证资料不完整，请重新连接九号账号。"
        : "账号认证后的业务初始化未完成，请稍后重试。",
      error.kind === "missing-credentials" ? "auth" : "upstream",
    );
  if (error instanceof PassportLoginHttpError)
    return new NinebotClientError(
      error.status === 401 || error.status === 403
        ? "登录状态已失效，请重新连接九号账号。"
        : "九号认证服务暂时不可用，请稍后重试。",
      error.status === 401 || error.status === 403 ? "auth" : "upstream",
    );
  return new NinebotClientError("认证请求未完成，请检查网络或本地存储后重试。", "upstream");
};

/** Maps authenticated business reads to the app contract without retaining upstream text. */
export const normalizeSdkReadError = (error: unknown): NinebotClientError => {
  if (error instanceof NinebotClientError) return error;
  if (
    error instanceof NinebotAuthSessionUnavailableError ||
    error instanceof PassportRefreshMaterialError ||
    error instanceof PassportLoginBusinessError ||
    error instanceof PassportLoginHttpError ||
    error instanceof NinebotBusinessSessionError ||
    error instanceof NinebotHumanVerificationRequiredError ||
    error instanceof NinebotPassportRedirectError
  )
    return normalizeSdkAuthError(error);
  // A business HTTP 403 can mean insufficient permission; undocumented payload
  // codes also cannot establish an expired session. Only explicit HTTP 401 does.
  if (error instanceof NinebotHttpError && error.status === 401)
    return new NinebotClientError("登录状态已失效，请重新连接九号账号。", "auth");
  return new NinebotClientError("九号数据暂时无法读取，请稍后重试。", "upstream");
};

const readWithSdkErrors = async <T>(read: () => Promise<T>): Promise<T> => {
  try {
    return await read();
  } catch (error) {
    throw normalizeSdkReadError(error);
  }
};

export interface NinebotSdkAppClientOptions {
  auth: NinebotAuthSessionManager;
  vehicleReader: VehicleReader;
  telemetryReader: VehicleTelemetryReader;
  travelReader: TravelReader;
  diagnostics: () => Promise<RuntimeSecurityStatus>;
  onProfileFailure?: (failure: ProfileFailure) => void;
}

/**
 * Composes the pure SDK session lifecycle and domain readers into the Electron
 * application client contract. No transport, filesystem, or legacy runtime is
 * created here; callers inject those boundaries explicitly.
 */
export const createNinebotSdkAppClient = ({
  auth,
  vehicleReader,
  telemetryReader,
  travelReader,
  diagnostics,
  onProfileFailure,
}: NinebotSdkAppClientOptions): NinebotAppClient => ({
  async login(user, areaCode, password) {
    try {
      await auth.loginWithPassword({ user, areaCode, password });
    } catch (error) {
      throw normalizeSdkAuthError(error);
    }
  },
  async requestSmsCode(phone, areaCode) {
    try {
      await auth.requestSmsCode({ phone, areaCode });
    } catch (error) {
      throw normalizeSdkAuthError(error);
    }
  },
  async loginWithSmsCode(phone, areaCode, code) {
    try {
      await auth.loginWithSmsCode({ phone, areaCode, code });
    } catch (error) {
      throw normalizeSdkAuthError(error);
    }
  },
  async logout() {
    try {
      await auth.logout();
    } catch (error) {
      throw normalizeSdkAuthError(error);
    }
  },
  async whoami() {
    try {
      return await auth.whoami();
    } catch (error) {
      try {
        onProfileFailure?.(classifyProfileFailure(error));
      } catch {
        /* Diagnostics never change the read result. */
      }
      throw normalizeSdkAuthError(error);
    }
  },
  diagnostics,
  vehicles: () => readWithSdkErrors(() => vehicleReader.vehicles()),
  vehicleStatus: (serialNumber) =>
    readWithSdkErrors(() => telemetryReader.vehicleStatus(serialNumber)),
  battery: (serialNumber) => readWithSdkErrors(() => telemetryReader.battery(serialNumber)),
  rides: (serialNumber, month) => readWithSdkErrors(() => travelReader.rides(serialNumber, month)),
  rideDetail: (serialNumber, travelId) =>
    readWithSdkErrors(() => travelReader.rideDetail(serialNumber, travelId)),
  clear() {
    vehicleReader.clear?.();
    telemetryReader.clear?.();
    travelReader.clear?.();
  },
});
