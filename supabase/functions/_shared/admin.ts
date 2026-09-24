// A minimal service-role client for the Edge Functions: plain fetch against the project's own
// Auth and REST APIs, no npm packages (fast cold start, nothing to download at boot).
// The service role key never leaves the function; every use checks the caller first.

export interface AuthUser {
  id: string;
  email?: string;
}

export class AdminError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function env(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

export function adminApi() {
  const url = env('SUPABASE_URL');
  const key = env('SUPABASE_SERVICE_ROLE_KEY');
  const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };

  async function request(method: string, path: string, body?: unknown): Promise<unknown> {
    const res = await fetch(`${url}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    if (!res.ok) {
      const message =
        data && typeof data === 'object' && 'message' in data ? String((data as { message: unknown }).message) : text;
      throw new AdminError(res.status, message);
    }
    return data;
  }

  return {
    /** The user an access token belongs to, checked by the Auth server; null when invalid. */
    async userFromToken(token: string | null): Promise<AuthUser | null> {
      if (!token) return null;
      const res = await fetch(`${url}/auth/v1/user`, { headers: { apikey: key, Authorization: `Bearer ${token}` } });
      if (!res.ok) return null;
      const user = (await res.json()) as AuthUser;
      return user && typeof user.id === 'string' ? user : null;
    },
    /** Calls a database function as the service role. Business errors keep their code as the message. */
    rpc: (fn: string, args: Record<string, unknown>) => request('POST', `/rest/v1/rpc/${fn}`, args),
    deleteUser: (id: string) => request('DELETE', `/auth/v1/admin/users/${id}`),
    updateUser: (id: string, attributes: Record<string, unknown>) =>
      request('PUT', `/auth/v1/admin/users/${id}`, attributes),
  };
}
