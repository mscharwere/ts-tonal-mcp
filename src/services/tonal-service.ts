import TonalClient, { TonalClientError } from '@dlwiest/ts-tonal-client';

// Auth0 locks a Tonal account after repeated failed logins, so a rejected login must
// not be replayed on every tool call.
export const REJECTED_LOGIN_RETRY_MS = 5 * 60 * 1000;

interface RejectedLogin {
  message: string;
  at: number;
}

export class TonalService {
  // All three maps are keyed per user (normalized to the env-var key), so one user's
  // rejected login can never block, or be cleared by, another user's.
  private clients: Map<string, TonalClient> = new Map();
  private pendingLogins: Map<string, Promise<TonalClient>> = new Map();
  private rejectedLogins: Map<string, RejectedLogin> = new Map();

  async getClient(user: string = 'carlos'): Promise<TonalClient> {
    // "Carlos" and "carlos" use the same credentials, so they must share state;
    // otherwise a different casing would sidestep the backoff.
    const userKey = user.toUpperCase();

    const cached = this.clients.get(userKey);
    if (cached) {
      return cached;
    }

    const rejected = this.rejectedLogins.get(userKey);
    if (rejected) {
      const remainingMs = REJECTED_LOGIN_RETRY_MS - (Date.now() - rejected.at);
      if (remainingMs > 0) {
        throw new Error(
          `Tonal login for user "${user}" was rejected (${rejected.message}). ` +
            `Not retrying for another ${Math.ceil(remainingMs / 1000)}s to avoid locking the account. ` +
            `Check the TONAL_USERNAME_${userKey} / TONAL_PASSWORD_${userKey} credentials.`
        );
      }
      this.rejectedLogins.delete(userKey);
    }

    // Concurrent first calls for the same user share one login.
    const pending = this.pendingLogins.get(userKey);
    if (pending) {
      return pending;
    }

    const username = process.env[`TONAL_USERNAME_${userKey}`];
    const password = process.env[`TONAL_PASSWORD_${userKey}`];

    if (!username || !password) {
      throw new Error(
        `TONAL_USERNAME_${userKey} and TONAL_PASSWORD_${userKey} environment variables are required for user "${user}"`
      );
    }

    const login = this.login(user, userKey, username, password);
    this.pendingLogins.set(userKey, login);
    return login;
  }

  private async login(
    user: string,
    userKey: string,
    username: string,
    password: string
  ): Promise<TonalClient> {
    console.error(`Initializing Tonal client for user "${user}"...`);
    try {
      const client = await TonalClient.create({ username, password });
      this.clients.set(userKey, client);
      this.rejectedLogins.delete(userKey);
      console.error(`Tonal client initialized successfully for user "${user}"`);
      return client;
    } catch (error) {
      // Only a 4xx answer means Tonal rejected the credentials or the request. Network
      // failures and 5xx responses are transient and are retried on the next call.
      if (
        error instanceof TonalClientError &&
        error.statusCode !== undefined &&
        error.statusCode >= 400 &&
        error.statusCode < 500
      ) {
        this.rejectedLogins.set(userKey, { message: error.message, at: Date.now() });
      }
      throw error;
    } finally {
      this.pendingLogins.delete(userKey);
    }
  }
}
