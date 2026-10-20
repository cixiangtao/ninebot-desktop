import { LoaderCircle, LockKeyhole, MessageSquareText, X } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import type {
  PasswordLoginInput,
  SmsCodeLoginInput,
  SmsCodeRequestInput,
} from "../../../shared/contracts";

type LoginMode = "password" | "sms";

interface LoginSheetProps {
  open: boolean;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onPasswordSubmit: (input: PasswordLoginInput) => Promise<void>;
  onRequestSmsCode: (input: SmsCodeRequestInput) => Promise<boolean>;
  onSmsCodeSubmit: (input: SmsCodeLoginInput) => Promise<void>;
  onClearError: () => void;
}

/** Provides password login and the non-bypassing two-step SMS flow. */
export const LoginSheet = ({
  open,
  busy,
  error,
  onClose,
  onPasswordSubmit,
  onRequestSmsCode,
  onSmsCodeSubmit,
  onClearError,
}: LoginSheetProps) => {
  const [mode, setMode] = useState<LoginMode>("password");
  const [areaCode, setAreaCode] = useState("86");
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);

  useEffect(() => {
    if (!open || cooldownSeconds <= 0) return;
    const timer = window.setTimeout(() => setCooldownSeconds((seconds) => seconds - 1), 1_000);
    return () => window.clearTimeout(timer);
  }, [cooldownSeconds, open]);

  if (!open) return null;

  const changeMode = (nextMode: LoginMode) => {
    setMode(nextMode);
    onClearError();
  };

  const submitPassword = async (event: FormEvent) => {
    event.preventDefault();
    await onPasswordSubmit({ areaCode, user, password });
    setPassword("");
  };

  const requestCode = async () => {
    const sent = await onRequestSmsCode({ areaCode, phone });
    if (!sent) return;
    setCodeSent(true);
    setCooldownSeconds(60);
  };

  const submitSmsCode = async (event: FormEvent) => {
    event.preventDefault();
    await onSmsCodeSubmit({ areaCode, phone, code });
    setCode("");
  };

  const phoneValid = /^\d{5,20}$/.test(phone);
  const codeValid = /^\d{4,8}$/.test(code);

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-slate-900/18 p-8 backdrop-blur-sm"
      role="presentation"
    >
      <section
        className="login-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="login-title"
      >
        <div className="flex items-start justify-between gap-8">
          <div>
            <div className="mb-5 grid size-12 place-items-center rounded-[14px] bg-[#e7faf7] text-[#079b8e]">
              {mode === "password" ? (
                <LockKeyhole size={23} strokeWidth={2} />
              ) : (
                <MessageSquareText size={23} strokeWidth={2} />
              )}
            </div>
            <h2
              id="login-title"
              className="text-[26px] font-[720] tracking-[-0.025em] text-[#182230]"
            >
              连接九号账号
            </h2>
            <p className="mt-2 max-w-[42ch] text-sm leading-6 text-slate-600">
              凭据通过加密连接提交给九号。认证成功后，本机会保存登录令牌以便下次恢复连接。
              客户端不包含车辆控制能力。
            </p>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="关闭登录">
            <X size={18} />
          </button>
        </div>

        <div className="login-mode-tabs" role="tablist" aria-label="登录方式">
          <button
            type="button"
            role="tab"
            aria-selected={mode === "password"}
            onClick={() => changeMode("password")}
          >
            密码登录
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "sms"}
            onClick={() => changeMode("sms")}
          >
            短信验证码
          </button>
        </div>

        {mode === "password" ? (
          <form className="mt-5 space-y-4" onSubmit={submitPassword}>
            <label className="field-label">
              <span>手机号或用户名</span>
              <div className="flex gap-2">
                <span className="login-area-prefix">+{areaCode}</span>
                <input
                  className="field-input flex-1"
                  value={user}
                  onChange={(event) => setUser(event.target.value)}
                  autoComplete="username"
                  required
                  autoFocus
                />
              </div>
            </label>
            <label className="field-label">
              <span>密码</span>
              <input
                className="field-input w-full"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                required
              />
            </label>
            <CountryCodeField areaCode={areaCode} onChange={setAreaCode} />
            <LoginError message={error} />
            <button className="primary-button mt-2 w-full" type="submit" disabled={busy}>
              {busy ? <LoaderCircle size={18} className="animate-spin" /> : null}
              {busy ? "正在连接" : "连接账号"}
            </button>
          </form>
        ) : (
          <form className="mt-5 space-y-4" onSubmit={submitSmsCode}>
            <label className="field-label">
              <span>手机号</span>
              <div className="flex gap-2">
                <span className="login-area-prefix">+{areaCode}</span>
                <input
                  className="field-input flex-1"
                  value={phone}
                  onChange={(event) => {
                    setPhone(event.target.value.replace(/\D/g, ""));
                    setCodeSent(false);
                  }}
                  autoComplete="tel"
                  inputMode="tel"
                  pattern="[0-9]{5,20}"
                  required
                  autoFocus
                />
              </div>
            </label>
            <label className="field-label">
              <span>短信验证码</span>
              <div className="flex gap-2">
                <input
                  className="field-input min-w-0 flex-1"
                  value={code}
                  onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
                  autoComplete="one-time-code"
                  inputMode="numeric"
                  pattern="[0-9]{4,8}"
                  placeholder="收到验证码后填写"
                  required
                />
                <button
                  className="sms-code-button"
                  type="button"
                  onClick={() => void requestCode()}
                  disabled={busy || !phoneValid || cooldownSeconds > 0}
                >
                  {cooldownSeconds > 0
                    ? cooldownSeconds + "s"
                    : codeSent
                      ? "重新发送"
                      : "发送验证码"}
                </button>
              </div>
            </label>
            <CountryCodeField
              areaCode={areaCode}
              onChange={(nextAreaCode) => {
                setAreaCode(nextAreaCode);
                setCodeSent(false);
                setCode("");
              }}
            />
            {codeSent && !error ? (
              <p className="login-sms-success" role="status">
                验证码请求已发送，请查看短信。验证码将提交给九号完成认证。
              </p>
            ) : null}
            <LoginError message={error} />
            <button
              className="primary-button mt-2 w-full"
              type="submit"
              disabled={busy || !codeSent || !codeValid}
            >
              {busy ? <LoaderCircle size={18} className="animate-spin" /> : null}
              {busy ? "正在验证" : "验证码登录"}
            </button>
          </form>
        )}

        <p className="login-warning mt-4 text-xs leading-5 text-slate-500">
          {mode === "password"
            ? "注意：密码只在登录调用期间保留在本机内存，不会写入磁盘或渲染层日志。"
            : "短信或密码登录都可能触发人机验证。当前客户端暂不支持完成该验证，请使用九号官方客户端登录。"}
        </p>
      </section>
    </div>
  );
};

interface CountryCodeFieldProps {
  areaCode: string;
  onChange: (areaCode: string) => void;
}

const CountryCodeField = ({ areaCode, onChange }: CountryCodeFieldProps) => (
  <label className="field-label max-w-28">
    <span>国家码</span>
    <input
      className="field-input w-full"
      inputMode="numeric"
      value={areaCode}
      onChange={(event) => onChange(event.target.value.replace(/\D/g, ""))}
      pattern="[0-9]{1,4}"
      required
    />
  </label>
);

const LoginError = ({ message }: { message: string | null }) =>
  message ? (
    <p className="login-error" role="alert">
      {message}
    </p>
  ) : null;
