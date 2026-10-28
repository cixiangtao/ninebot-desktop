import { ninebotSmsVerification } from "@jiuhao/ninebot-client";

/** A local shell for the provider's UI; no phone number, account token or password. */
export const createSmsVerificationPage = (nonce: string) => `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>短信登录验证</title>
<style>body{margin:0;background:#f5f7f8;color:#172332;font:14px system-ui,sans-serif}main{padding:28px 26px}h1{font-size:19px;margin:0 0 12px}p{line-height:1.65;color:#647481}#captcha{min-height:210px;margin:24px 0}#verification-feedback{position:fixed;top:12px;left:26px;right:26px;z-index:2147483647;padding:8px;background:#f5f7f8;border-radius:12px;font-size:12px}button{border:1px solid #e3e9eb;background:#ffffff;border-radius:12px;padding:10px 20px;font:inherit;cursor:pointer}#cancel{position:fixed;right:26px;bottom:16px;z-index:2147483647}button:focus-visible{outline:3px solid #087f76}small{display:block;color:#647481;line-height:1.6;margin-top:18px}</style></head>
<body><main><h1>完成验证后发送短信</h1><p id="status" role="status">正在加载九号使用的网易易盾验证组件…</p><div id="captcha"></div><p id="verification-feedback" role="status" hidden></p><button id="cancel" type="button">取消验证</button><small>请按组件提示完成验证。验证成功后，将继续向刚才填写的手机号发送验证码。</small></main>
<script nonce="${nonce}">
document.getElementById('cancel').onclick = () => window.smsVerification.cancel();
const feedback = document.getElementById('verification-feedback');
let failedAttempts = 0;
const showFailure = (error) => {
  failedAttempts += 1;
  // Only bounded numeric error codes are displayed; never include provider payloads or validation tokens.
  const codes = [...new Set([error?.code, error?.data?.errorCode]
    .filter(value => (typeof value === 'number' || typeof value === 'string') && /^-?\\d{1,8}$/.test(String(value)))
    .map(String))];
  feedback.hidden = false;
  feedback.textContent = '验证未通过，已失败 ' + failedAttempts + ' 次' +
    (codes.length ? '（组件错误码：' + codes.join(' / ') + '）' : '（组件未提供错误码）') +
    (failedAttempts >= 3 ? '。连续失败时可取消验证，保留此错误码用于排查，避免反复尝试。' : '。');
};
const loadTimer = setTimeout(() => window.smsVerification.fail(), 25000);
const script = document.createElement('script');
script.src = ${JSON.stringify(ninebotSmsVerification.scriptUrl)};
script.onerror = () => window.smsVerification.fail();
script.onload = () => {
  if (typeof window.initNECaptcha !== 'function') return window.smsVerification.fail();
  try { window.initNECaptcha({
    captchaId: ${JSON.stringify(ninebotSmsVerification.captchaId)},
    element: '#captcha', mode: 'popup', width: '320px', apiVersion: 2, protocol: 'https', lang: 'zh-CN',
    popupStyles: { position: 'fixed', top: '20%' }, feedbackEnable: false,
    onReady: () => { clearTimeout(loadTimer); document.getElementById('status').textContent = '请完成下方人机验证'; },
    onVerify: (error, result) => {
      if (!error && result && typeof result.validate === 'string' && result.validate.trim()) {
        feedback.hidden = true;
        window.smsVerification.complete(result.validate);
      } else showFailure(error);
    },
    onClose: () => window.smsVerification.cancel(),
    onError: () => window.smsVerification.fail()
  }, (instance) => {
    try {
      if (typeof instance?.verify !== 'function') return window.smsVerification.fail();
      instance.verify();
    } catch { window.smsVerification.fail(); }
  }, () => window.smsVerification.fail());
  } catch { window.smsVerification.fail(); }
};
document.head.appendChild(script);
</script></body></html>`;

const providerSources = [
  "https://*.126.net",
  "https://*.127.net",
  "https://*.163.com",
  "https://*.163yun.com",
  "https://*.netease.com",
].join(" ");

/**
 * The provider renders templates with new Function (observed in its loader/core).
 * Allow eval only in this isolated, credential-free window, never in the app page.
 */
export const smsVerificationCsp = (nonce: string) =>
  `default-src 'none'; script-src 'nonce-${nonce}' 'unsafe-eval' ${providerSources}; style-src 'unsafe-inline' ${providerSources}; img-src data: blob: ${providerSources}; connect-src ${providerSources}; font-src ${providerSources}; base-uri 'none'; form-action 'none'; frame-src 'none'; object-src 'none'`;

export const isSmsVerificationResource = (url: string): boolean => {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === "https:" &&
      !parsed.username &&
      !parsed.password &&
      ["126.net", "127.net", "163.com", "163yun.com", "netease.com"].some((domain) =>
        parsed.hostname.endsWith(`.${domain}`),
      )
    );
  } catch {
    return false;
  }
};
