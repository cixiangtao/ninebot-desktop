/**
 * Public captcha configuration observed in the official Android 6.10.12 login flow.
 * Hosts show the provider's interactive UI and pass its successful `validate`
 * result to requestSmsCode. This is a public site identifier, not an account secret.
 */
export const ninebotSmsVerification = Object.freeze({
  provider: "netease-yidun",
  captchaId: "78160de0d8604344b094f6e36df10083",
  scriptUrl: "https://cstaticdun.126.net/load.min.js",
} as const);
