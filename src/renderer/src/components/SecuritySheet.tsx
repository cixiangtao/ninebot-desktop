import {
  Binary,
  CircleUserRound,
  Database,
  FolderLock,
  KeyRound,
  LoaderCircle,
  LogOut,
  RefreshCw,
  ShieldCheck,
  TerminalSquare,
  X,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import type { AccountProfile, RuntimeSecurityStatus } from "../../../shared/contracts";

interface SecuritySheetProps {
  open: boolean;
  busy: boolean;
  error: string | null;
  status: RuntimeSecurityStatus | null;
  profile: AccountProfile | null;
  profileError: string | null;
  onClose: () => void;
  onRefresh: () => Promise<void>;
  onLogout: () => Promise<void>;
}

const binaryStatusLabels: Record<RuntimeSecurityStatus["binary"]["status"], string> = {
  verified: "完整性已验证",
  mismatch: "哈希不匹配，已阻止执行",
  unsupported: "当前平台尚未验证",
  unavailable: "暂时无法校验",
};

const permissionLabels: Record<RuntimeSecurityStatus["storage"]["permissions"], string> = {
  restricted: "仅当前用户可读写",
  "platform-default": "由当前 Windows 用户保护",
  "needs-attention": "权限需要收紧",
  unavailable: "暂时无法检查",
};

const identifierKindLabels: Record<AccountProfile["identifierKind"], string> = {
  phone: "手机号账号",
  email: "邮箱账号",
  username: "用户名账号",
  unknown: "九号账号",
};

const shortenHash = (hash: string | null) =>
  hash ? `${hash.slice(0, 16)}…${hash.slice(-8)}` : "未取得";

export const SecuritySheet = ({
  open,
  busy,
  error,
  status,
  profile,
  profileError,
  onClose,
  onRefresh,
  onLogout,
}: SecuritySheetProps) => {
  const [confirmingLogout, setConfirmingLogout] = useState(false);

  if (!open) return null;

  const close = () => {
    setConfirmingLogout(false);
    onClose();
  };

  const logout = async () => {
    await onLogout();
    setConfirmingLogout(false);
  };

  const binaryTone =
    status?.binary.status === "verified"
      ? "good"
      : status?.binary.status === "mismatch"
        ? "danger"
        : "warning";

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-slate-900/18 p-8 backdrop-blur-sm"
      role="presentation"
    >
      <section
        className="security-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="security-title"
      >
        <header className="flex items-start justify-between gap-8 px-7 pt-7">
          <div className="flex min-w-0 items-start gap-4">
            <div className="grid size-12 flex-none place-items-center rounded-[14px] bg-[#e7faf7] text-[#079b8e]">
              <ShieldCheck size={24} strokeWidth={2} />
            </div>
            <div className="min-w-0">
              <h2
                id="security-title"
                className="text-[24px] font-[720] tracking-[-0.025em] text-[#182230]"
              >
                运行时安全
              </h2>
              <p className="mt-1 text-sm leading-6 text-slate-600">
                检查 ninecli 的执行来源、权限和客户端开放边界。
              </p>
            </div>
          </div>
          <button className="icon-button" type="button" onClick={close} aria-label="关闭设置">
            <X size={18} />
          </button>
        </header>

        <div className="security-sheet-scroll">
          {busy && !status ? (
            <div className="security-loading" role="status">
              <LoaderCircle size={19} className="animate-spin text-[#0a9f92]" />
              正在核对本机 ninecli…
            </div>
          ) : null}

          {error ? (
            <div className="security-error" role="alert">
              <span>{error}</span>
              <button type="button" onClick={() => void onRefresh()} disabled={busy}>
                <RefreshCw size={14} className={busy ? "animate-spin" : ""} />
                重试
              </button>
            </div>
          ) : null}

          {status || profile || profileError ? (
            <div className="security-account">
              <span className="security-account-icon">
                <CircleUserRound size={20} />
              </span>
              <span className="min-w-0 flex-1">
                <small>当前九号账号</small>
                <strong>
                  {profile?.maskedIdentifier ??
                    (status?.storage.tokensPresent ? "未取得账号标识" : "当前未连接九号账号")}
                </strong>
                <span>
                  {profile
                    ? `${identifierKindLabels[profile.identifierKind]} · ${
                        profile.passwordConfigured === true
                          ? "已设置密码"
                          : profile.passwordConfigured === false
                            ? "未设置密码"
                            : "密码状态未知"
                      }`
                    : (profileError ??
                      (status?.storage.tokensPresent
                        ? "本地令牌存在，但本次账号校验未返回可显示标识。"
                        : "连接账号后仅显示脱敏标识。"))}
                </span>
              </span>
            </div>
          ) : null}

          {status ? (
            <div className="security-group">
              <SecurityRow
                icon={<Binary size={18} />}
                label={`ninecli ${status.version}`}
                value={binaryStatusLabels[status.binary.status]}
                hint={`${status.binary.platform} · ${status.binary.architecture} · ${shortenHash(status.binary.sha256)}`}
                tone={binaryTone}
              />
              <SecurityRow
                icon={<TerminalSquare size={18} />}
                label="命令边界"
                value="固定白名单"
                hint={`${status.policy.allowedCommands.join(" · ")}；不接受渲染层自由命令`}
                tone="good"
              />
              <SecurityRow
                icon={<FolderLock size={18} />}
                label={`本地存储 · ${status.storage.directoryName}`}
                value={permissionLabels[status.storage.permissions]}
                hint={status.storage.tokensPresent ? "检测到本地登录令牌" : "当前没有本地登录令牌"}
                tone={
                  status.storage.permissions === "restricted" ||
                  status.storage.permissions === "platform-default"
                    ? "good"
                    : "warning"
                }
              />
              <SecurityRow
                icon={<ShieldCheck size={18} />}
                label="进程隔离"
                value="最小环境变量"
                hint="保留网络代理与证书配置；不继承项目密钥等无关环境变量"
                tone="good"
              />
              <SecurityRow
                icon={<Database size={18} />}
                label="会话读取缓存"
                value="仅内存"
                hint="只缓存解析后的领域数据，不保存 ninecli 原始响应；手动刷新会绕过缓存"
                tone={
                  status.policy.sessionCache.storage === "memory-only" &&
                  !status.policy.sessionCache.rawResponsesStored &&
                  !status.policy.sessionCache.persistsAcrossRestarts &&
                  status.policy.sessionCache.manualRefreshBypasses
                    ? "good"
                    : "warning"
                }
              />
              <SecurityRow
                icon={<KeyRound size={18} />}
                label="登录凭据传输"
                value="本地进程参数"
                hint="密码或短信验证码不会进入日志，但登录瞬间可能被本机进程工具观察到"
                tone="warning"
              />
            </div>
          ) : null}

          <div className="security-boundary">
            <strong>车辆控制能力未开放</strong>
            <span>客户端没有鸣笛、解锁、启动、熄火或开座桶入口。</span>
          </div>

          <div className="security-session">
            <div>
              <strong>本地登录会话</strong>
              <p>退出后清除 ninecli 令牌与车辆缓存，保留非敏感配置。</p>
            </div>
            {confirmingLogout ? (
              <div className="flex flex-none items-center gap-2">
                <button
                  className="quiet-button"
                  type="button"
                  onClick={() => setConfirmingLogout(false)}
                  disabled={busy}
                >
                  取消
                </button>
                <button
                  className="danger-button"
                  type="button"
                  onClick={() => void logout()}
                  disabled={busy}
                >
                  {busy ? <LoaderCircle size={15} className="animate-spin" /> : null}
                  确认清除
                </button>
              </div>
            ) : (
              <button
                className="danger-button flex-none"
                type="button"
                onClick={() => setConfirmingLogout(true)}
                disabled={busy || !status?.storage.tokensPresent}
              >
                <LogOut size={15} />
                退出并清除令牌
              </button>
            )}
          </div>
        </div>
      </section>
    </div>
  );
};

interface SecurityRowProps {
  icon: ReactNode;
  label: string;
  value: string;
  hint: string;
  tone: "good" | "warning" | "danger";
}

const SecurityRow = ({ icon, label, value, hint, tone }: SecurityRowProps) => (
  <div className="security-row">
    <span className="security-row-icon">{icon}</span>
    <span className="min-w-0 flex-1">
      <strong>{label}</strong>
      <span>{hint}</span>
    </span>
    <span className={`security-value security-value-${tone}`}>{value}</span>
  </div>
);
