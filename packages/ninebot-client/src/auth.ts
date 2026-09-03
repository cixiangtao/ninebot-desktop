/** Credentials supplied for one password-login attempt. */
export interface NinebotPasswordCredentials {
  areaCode: string;
  user: string;
  /** The caller owns this value; the session manager never stores it. */
  password: string;
}

/** Inputs for requesting an SMS verification code. */
export interface NinebotSmsCodeRequest {
  areaCode: string;
  phone: string;
}

/** Inputs for completing an SMS login attempt. */
export interface NinebotSmsLoginInput extends NinebotSmsCodeRequest {
  code: string;
}

/** Persistable authenticated material required by the read-only service clients. */
export interface NinebotAuthSession {
  accessToken: string;
  businessUid: string;
  /** Passport UUID required by the business metadata bootstrap request. */
  uuid?: string;
  /** Optional absolute expiry supplied by the verified auth response. */
  expiresAtMs?: number;
  /** Optional refresh token supplied by the verified auth response. */
  refreshToken?: string;
}

/** Async persistence boundary for the authenticated session. */
export interface NinebotAuthSessionStore {
  load(): Promise<NinebotAuthSession | null>;
  save(session: NinebotAuthSession): Promise<void>;
  clear(): Promise<void>;
}

/** Verified protocol implementation supplied by a runtime-specific adapter. */
export interface NinebotAuthProvider {
  loginWithPassword(credentials: NinebotPasswordCredentials): Promise<NinebotAuthSession>;
  requestSmsCode(input: NinebotSmsCodeRequest): Promise<void>;
  loginWithSmsCode(input: NinebotSmsLoginInput): Promise<NinebotAuthSession>;
  whoami<T = unknown>(session: NinebotAuthSession): Promise<T>;
  refresh?(session: NinebotAuthSession): Promise<NinebotAuthSession>;
  logout?(session: NinebotAuthSession): Promise<void>;
}

export interface NinebotAuthSessionManagerOptions {
  provider: NinebotAuthProvider;
  store: NinebotAuthSessionStore;
  /** Clock injection keeps expiry behavior deterministic in tests and replays. */
  now?: () => number;
  /** Refresh when the session expires within this many milliseconds. */
  refreshSkewMs?: number;
}

const defaultRefreshSkewMs = 60_000;

const cloneSession = (session: NinebotAuthSession): NinebotAuthSession => {
  const copy: NinebotAuthSession = {
    accessToken: session.accessToken,
    businessUid: session.businessUid,
  };
  if (session.uuid !== undefined) copy.uuid = session.uuid;
  if (session.expiresAtMs !== undefined) copy.expiresAtMs = session.expiresAtMs;
  if (session.refreshToken !== undefined) copy.refreshToken = session.refreshToken;
  return copy;
};

const validateSession = (session: NinebotAuthSession): NinebotAuthSession => {
  if (!session || typeof session !== "object") {
    throw new Error("Ninebot auth session is invalid");
  }
  if (!session.accessToken.trim() || !session.businessUid.trim()) {
    throw new Error("Ninebot auth session is missing required credentials");
  }
  if (
    session.expiresAtMs !== undefined &&
    (!Number.isFinite(session.expiresAtMs) || session.expiresAtMs <= 0)
  ) {
    throw new Error("Ninebot auth session expiry is invalid");
  }
  if (session.refreshToken !== undefined && !session.refreshToken.trim()) {
    throw new Error("Ninebot auth session refresh token is invalid");
  }
  if (session.uuid !== undefined && !session.uuid.trim()) {
    throw new Error("Ninebot auth session uuid is invalid");
  }
  return cloneSession(session);
};

/** In-memory store useful for tests and browser callers that own persistence separately. */
export const createMemoryNinebotAuthSessionStore = (
  initialSession: NinebotAuthSession | null = null,
): NinebotAuthSessionStore => {
  let session = initialSession === null ? null : validateSession(initialSession);
  return {
    async load() {
      return session === null ? null : cloneSession(session);
    },
    async save(nextSession) {
      session = validateSession(nextSession);
    },
    async clear() {
      session = null;
    },
  };
};

/**
 * Coordinates authentication without retaining passwords or protocol-specific fields.
 *
 * The provider owns the verified Ninebot wire protocol. This manager owns only session
 * replacement, persistence, expiry-aware refresh, and logout cleanup so Electron, Web,
 * and React Native can share the same lifecycle contract.
 */
export class NinebotAuthSessionManager {
  private session: NinebotAuthSession | null = null;
  private readonly now: () => number;
  private readonly refreshSkewMs: number;

  constructor(private readonly options: NinebotAuthSessionManagerOptions) {
    this.now = options.now ?? Date.now;
    this.refreshSkewMs = options.refreshSkewMs ?? defaultRefreshSkewMs;
    if (!Number.isFinite(this.refreshSkewMs) || this.refreshSkewMs < 0) {
      throw new Error("Ninebot auth refreshSkewMs must be a non-negative finite number");
    }
  }

  /** Loads a persisted session without contacting the upstream service. */
  async restore(): Promise<NinebotAuthSession | null> {
    const stored = await this.options.store.load();
    this.session = stored === null ? null : validateSession(stored);
    return this.getSession();
  }

  /** Returns a defensive copy of the current session, or null when signed out. */
  getSession(): NinebotAuthSession | null {
    return this.session === null ? null : cloneSession(this.session);
  }

  get isAuthenticated() {
    return this.session !== null;
  }

  /** Returns a current session, refreshing and persisting it when it is near expiry. */
  async ensureSession(): Promise<NinebotAuthSession> {
    return this.ensureFreshSession();
  }

  async loginWithPassword(credentials: NinebotPasswordCredentials) {
    const nextSession = validateSession(await this.options.provider.loginWithPassword(credentials));
    await this.replaceSession(nextSession);
    return this.getSession() as NinebotAuthSession;
  }

  async requestSmsCode(input: NinebotSmsCodeRequest) {
    await this.options.provider.requestSmsCode(input);
  }

  async loginWithSmsCode(input: NinebotSmsLoginInput) {
    const nextSession = validateSession(await this.options.provider.loginWithSmsCode(input));
    await this.replaceSession(nextSession);
    return this.getSession() as NinebotAuthSession;
  }

  /**
   * Returns the current profile and refreshes first when the provider supports refresh.
   * An expired session without a refresh implementation fails closed.
   */
  async whoami<T = unknown>(): Promise<T> {
    const session = await this.ensureSession();
    return this.options.provider.whoami<T>(session);
  }

  /** Refreshes explicitly and persists the replacement session. */
  async refresh(): Promise<NinebotAuthSession> {
    const current = this.requireSession();
    if (!this.options.provider.refresh) {
      throw new Error("Ninebot auth provider does not support token refresh");
    }
    const nextSession = validateSession(await this.options.provider.refresh(current));
    await this.replaceSession(nextSession);
    return this.getSession() as NinebotAuthSession;
  }

  /** Clears local credentials even when an optional upstream revoke call fails. */
  async logout(): Promise<void> {
    const current = this.session;
    this.session = null;
    let upstreamError: unknown;
    try {
      if (current !== null) await this.options.provider.logout?.(current);
    } catch (error) {
      upstreamError = error;
    } finally {
      await this.options.store.clear();
    }
    if (upstreamError !== undefined) throw upstreamError;
  }

  private requireSession() {
    if (this.session === null) throw new Error("Ninebot auth session is not available");
    return cloneSession(this.session);
  }

  private async replaceSession(nextSession: NinebotAuthSession) {
    await this.options.store.save(nextSession);
    this.session = cloneSession(nextSession);
  }

  private async ensureFreshSession() {
    const current = this.requireSession();
    if (
      current.expiresAtMs === undefined ||
      current.expiresAtMs > this.now() + this.refreshSkewMs
    ) {
      return current;
    }
    return this.refresh();
  }
}
