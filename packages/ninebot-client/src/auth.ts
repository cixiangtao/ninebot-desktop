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

/** Account credentials returned by Passport, before business identity is initialized. */
export interface NinebotPassportSession {
  accessToken: string;
  /** Passport UUID required by the business metadata bootstrap request. */
  uuid?: string;
  /** Optional absolute expiry supplied by the verified auth response. */
  expiresAtMs?: number;
  /** Optional refresh token supplied by the verified auth response. */
  refreshToken?: string;
}

/** Complete authenticated material accepted by storage and vehicle service clients. */
export interface NinebotAuthSession extends NinebotPassportSession {
  businessUid: string;
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
  private refreshPromise: Promise<NinebotAuthSession> | null = null;
  private readonly now: () => number;
  private readonly refreshSkewMs: number;
  private generation = 0;
  private persistence: Promise<void> = Promise.resolve();

  constructor(private readonly options: NinebotAuthSessionManagerOptions) {
    this.now = options.now ?? Date.now;
    this.refreshSkewMs = options.refreshSkewMs ?? defaultRefreshSkewMs;
    if (!Number.isFinite(this.refreshSkewMs) || this.refreshSkewMs < 0) {
      throw new Error("Ninebot auth refreshSkewMs must be a non-negative finite number");
    }
  }

  /** Loads a persisted session without contacting the upstream service. */
  async restore(): Promise<NinebotAuthSession | null> {
    const generation = ++this.generation;
    this.refreshPromise = null;
    const stored = await this.persist(() => this.options.store.load());
    this.assertCurrent(generation);
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
    const generation = ++this.generation;
    this.refreshPromise = null;
    const nextSession = validateSession(await this.options.provider.loginWithPassword(credentials));
    await this.replaceSession(nextSession, generation);
    return cloneSession(nextSession);
  }

  async requestSmsCode(input: NinebotSmsCodeRequest) {
    await this.options.provider.requestSmsCode(input);
  }

  async loginWithSmsCode(input: NinebotSmsLoginInput) {
    const generation = ++this.generation;
    this.refreshPromise = null;
    const nextSession = validateSession(await this.options.provider.loginWithSmsCode(input));
    await this.replaceSession(nextSession, generation);
    return cloneSession(nextSession);
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
    if (this.refreshPromise !== null) return cloneSession(await this.refreshPromise);
    const operation = this.performRefresh(this.generation);
    this.refreshPromise = operation;
    try {
      return cloneSession(await operation);
    } finally {
      if (this.refreshPromise === operation) this.refreshPromise = null;
    }
  }

  /** Clears local credentials even when an optional upstream revoke call fails. */
  async logout(): Promise<void> {
    const current = this.session;
    this.generation += 1;
    this.session = null;
    this.refreshPromise = null;
    // Queue clearing after any save already in progress, before contacting upstream.
    await this.persist(() => this.options.store.clear());
    if (current !== null) await this.options.provider.logout?.(current);
  }

  private requireSession() {
    if (this.session === null) throw new Error("Ninebot auth session is not available");
    return cloneSession(this.session);
  }

  private assertCurrent(generation: number) {
    if (generation !== this.generation) throw new Error("Ninebot auth operation was superseded");
  }

  private persist<T>(operation: () => Promise<T>): Promise<T> {
    const pending = this.persistence.then(operation);
    this.persistence = pending.then(
      () => undefined,
      () => undefined,
    );
    return pending;
  }

  private async replaceSession(
    nextSession: NinebotAuthSession,
    generation: number,
    expectedSession?: NinebotAuthSession,
  ) {
    await this.persist(async () => {
      this.assertCurrent(generation);
      if (expectedSession !== undefined && this.session !== expectedSession) {
        throw new Error("Ninebot auth operation was superseded");
      }
      const previous = this.session;
      await this.options.store.save(nextSession);
      if (generation !== this.generation) {
        // A newer attempt may fail before it writes; do not leave this stale save on disk.
        if (previous === null) await this.options.store.clear();
        else await this.options.store.save(cloneSession(previous));
      }
      this.assertCurrent(generation);
      this.session = cloneSession(nextSession);
    });
  }

  private async performRefresh(generation: number): Promise<NinebotAuthSession> {
    const source = this.session;
    const current = this.requireSession();
    if (!this.options.provider.refresh) {
      throw new Error("Ninebot auth provider does not support token refresh");
    }
    const nextSession = validateSession(await this.options.provider.refresh(current));
    await this.replaceSession(nextSession, generation, source ?? undefined);
    return nextSession;
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
