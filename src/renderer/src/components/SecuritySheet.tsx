import {
  Binary,
  CircleUserRound,
  Database,
  FolderLock,
  KeyRound,
  LoaderCircle,
  LogOut,
  Plus,
  ArrowRightLeft,
  Trash2,
  RefreshCw,
  ShieldCheck,
  TerminalSquare,
  Timer,
  X,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import type {
  AccountProfile,
  RuntimeSecurityStatus,
  SavedAccountsState,
} from "../../../shared/contracts";

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
  accounts?: SavedAccountsState | null;
  onAddAccount?: () => void;
  onSwitchAccount?: (id: string) => Promise<void>;
  onRemoveAccount?: (id: string) => Promise<void>;
}

const binaryStatusLabels: Record<RuntimeSecurityStatus["binary"]["status"], string> = {
  "not-required": "内置只读服务",
  verified: "完整性已验证",
  mismatch: "哈希不匹配，已阻止执行",
  unsupported: "当前平台尚未验证",
  unavailable: "暂时无法校验",
};

const permissionLabels: Record<RuntimeSecurityStatus["storage"]["permissions"], string> = {
  restricted: "仅当前用户可读写",
  "platform-default": "由当前系统用户保护",
  "needs-attention": "权限需要收紧",
  unavailable: "暂时无法检查",
};

const identifierKindLabels: Record<AccountProfile["identifierKind"], string> = {
  phone: "手机号账号",
  email: "邮箱账号",
  username: "用户名账号",
  unknown: "九号账号",
};

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
  accounts,
  onAddAccount,
  onSwitchAccount,
  onRemoveAccount,
}: SecuritySheetProps) => {
  const [confirmingRemove, setConfirmingRemove] = useState<string | null>(null);
  const [confirmingLogout, setConfirmingLogout] = useState(false);

  if (!open) return null;

  const close = () => {
    setConfirmingLogout(false);
    setConfirmingRemove(null);
    onClose();
  };

  const logout = async () => {
    await onLogout();
    setConfirmingLogout(false);
  };

  const sdkRuntime = status?.version === "typescript-sdk";
  const binaryTone =
    status?.binary.status === "verified" || status?.binary.status === "not-required"
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
                设置
              </h2>
              <p className="mt-1 text-sm leading-6 text-slate-600">
                管理九号账号、登录状态与本机数据。
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
              正在核对本地运行环境…
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

          <div className="saved-accounts-heading">
            <div>
              <h3>账号</h3>
              <p>
                {accounts?.supported
                  ? "登录状态保存在本机，切换后显示对应车辆与轨迹。"
                  : "连接九号账号，查看车辆与骑行轨迹。"}
              </p>
            </div>
            {onAddAccount ? (
              <button className="quiet-button" type="button" onClick={onAddAccount} disabled={busy}>
                <Plus size={15} />
                {accounts?.supported
                  ? "添加账号"
                  : status?.storage.tokensPresent
                    ? "重新连接"
                    : "连接账号"}
              </button>
            ) : null}
          </div>
          {accounts?.supported && profileError ? (
            <p className="security-error" role="alert">
              {profileError}
            </p>
          ) : null}
          {accounts?.supported ? (
            <div className="saved-accounts-list" aria-label="已保存的账号">
              {accounts.accounts.length === 0 ? (
                <p className="saved-accounts-empty">
                  还没有保存的账号，登录成功后会自动保存在这里。
                </p>
              ) : null}
              {accounts.accounts.map((account) => (
                <div className="saved-account-row" key={account.id}>
                  <span className="security-account-icon">
                    <CircleUserRound size={20} />
                  </span>
                  <div className="saved-account-identity">
                    <strong>{account.label}</strong>
                    <span>
                      {account.needsLogin
                        ? "登录状态已失效，请重新连接"
                        : account.id === accounts.activeId
                          ? "当前使用中"
                          : "已保存在本机"}
                    </span>
                  </div>
                  {account.id === accounts.activeId ? (
                    <span className="saved-account-current">
                      {account.needsLogin ? "当前账号" : "使用中"}
                    </span>
                  ) : null}
                  {account.id !== accounts.activeId || account.needsLogin ? (
                    <button
                      className="quiet-button"
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        account.needsLogin ? onAddAccount?.() : void onSwitchAccount?.(account.id)
                      }
                    >
                      <ArrowRightLeft size={14} />
                      {account.needsLogin ? "重新连接" : "切换"}
                    </button>
                  ) : null}
                  {account.id !== accounts.activeId ? (
                    confirmingRemove === account.id ? (
                      <span className="saved-account-actions">
                        <button
                          className="quiet-button"
                          type="button"
                          disabled={busy}
                          onClick={() => setConfirmingRemove(null)}
                        >
                          取消
                        </button>
                        <button
                          className="danger-button"
                          type="button"
                          disabled={busy}
                          onClick={async () => {
                            await onRemoveAccount?.(account.id);
                            setConfirmingRemove(null);
                          }}
                        >
                          确认移除
                        </button>
                      </span>
                    ) : (
                      <button
                        className="icon-button"
                        type="button"
                        disabled={busy}
                        aria-label={`移除 ${account.label}`}
                        title="移除此账号的本机登录状态"
                        onClick={() => setConfirmingRemove(account.id)}
                      >
                        <Trash2 size={16} />
                      </button>
                    )
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}

          {!accounts?.supported && (status || profile || profileError) ? (
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
            <details className="settings-privacy">
              <summary>隐私与安全</summary>
              <div className="security-group">
                <SecurityRow
                  icon={<Timer size={18} />}
                  label={sdkRuntime ? "读取等待上限" : "候选读取等待上限"}
                  value={`${Math.round(status.candidate.requestTimeoutMs / 1000)} 秒`}
                  hint={
                    sdkRuntime
                      ? "超时后返回错误，可手动重试"
                      : "候选数据源超时后自动回退到默认读取路径"
                  }
                  tone="good"
                />
                <SecurityRow
                  icon={<Database size={18} />}
                  label={sdkRuntime ? "内置数据服务" : "候选数据源"}
                  value={`${Object.values(status.candidate.domains).filter((source) => source === "candidate").length}/3 已启用`}
                  hint={
                    sdkRuntime
                      ? "车辆、状态和行程均使用内置只读服务"
                      : "只显示启用数量；未启用域继续使用默认读取路径"
                  }
                  tone="good"
                />
                <SecurityRow
                  icon={<Binary size={18} />}
                  label="本地数据运行环境"
                  value={binaryStatusLabels[status.binary.status]}
                  hint={
                    sdkRuntime ? "无需启动外部数据进程" : "固定版本运行，连接前会校验文件完整性"
                  }
                  tone={binaryTone}
                />
                <SecurityRow
                  icon={<TerminalSquare size={18} />}
                  label="数据读取边界"
                  value="只读白名单"
                  hint="仅允许读取账号、车辆状态、电池和骑行记录；页面不能执行任意命令"
                  tone="good"
                />
                <SecurityRow
                  icon={<FolderLock size={18} />}
                  label="本地存储"
                  value={permissionLabels[status.storage.permissions]}
                  hint={
                    status.storage.tokensPresent ? "检测到本地登录令牌" : "当前没有本地登录令牌"
                  }
                  tone={
                    status.storage.permissions === "restricted" ||
                    status.storage.permissions === "platform-default"
                      ? "good"
                      : "warning"
                  }
                />
                <SecurityRow
                  icon={<ShieldCheck size={18} />}
                  label={sdkRuntime ? "数据访问隔离" : "进程隔离"}
                  value={sdkRuntime ? "受限接口" : "最小环境变量"}
                  hint={
                    sdkRuntime
                      ? "页面仅能调用已开放的本地接口"
                      : "保留网络代理与证书配置；不继承项目密钥等无关环境变量"
                  }
                  tone="good"
                />
                <SecurityRow
                  icon={<Database size={18} />}
                  label="会话读取缓存"
                  value="仅内存"
                  hint="只缓存解析后的展示数据，不保存上游原始响应；手动刷新会绕过缓存"
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
                  value={sdkRuntime ? "进程内调用" : "本地进程参数"}
                  hint={
                    sdkRuntime
                      ? "密码和验证码只在内存中传递，不作为命令行参数"
                      : "密码或短信验证码不会进入日志，但登录瞬间可能被本机进程工具观察到"
                  }
                  tone={sdkRuntime ? "good" : "warning"}
                />
              </div>
            </details>
          ) : null}

          <div className="security-boundary">
            <strong>车辆控制能力未开放</strong>
            <span>客户端没有鸣笛、解锁、启动、熄火或开座桶入口。</span>
          </div>

          <div className="security-session">
            <div>
              <strong>本地登录会话</strong>
              <p>
                {accounts?.supported
                  ? "退出会移除当前账号的本机登录状态，其他已保存账号保留。"
                  : sdkRuntime
                    ? "退出后清除登录令牌与会话内存缓存；车辆路由元数据按账号隔离保留。"
                    : "退出后清除本地登录令牌与车辆缓存，保留非敏感配置。"}
              </p>
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
                {accounts?.supported ? "退出当前账号" : "退出并清除令牌"}
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
