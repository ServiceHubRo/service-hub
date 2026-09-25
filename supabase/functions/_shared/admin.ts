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

  async function request(method: string, path: string, body?: unknown, extra: Record<string, string> = {}): Promise<unknown> {
    const res = await fetch(`${url}${path}`, {
      method,
      headers: { ...headers, ...extra },
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
    /** Reads rows through the REST API as the service role, e.g. `shops?select=id&id=eq.…`. */
    select: async (query: string) => (await request('GET', `/rest/v1/${query}`)) as Record<string, unknown>[],
    /** Updates the rows a REST query selects, as the service role. */
    update: (query: string, values: Record<string, unknown>) => request('PATCH', `/rest/v1/${query}`, values),
    /** Like update, answering the rows it changed (none when the filter matched nothing). */
    updateReturning: async (query: string, values: Record<string, unknown>) =>
      ((await request('PATCH', `/rest/v1/${query}`, values, { Prefer: 'return=representation' })) ?? []) as Record<
        string,
        unknown
      >[],
    /** Stores a file in a Storage bucket (replacing one already there), as the service role. */
    async upload(bucket: string, path: string, bytes: Uint8Array, contentType: string): Promise<void> {
      const res = await fetch(`${url}/storage/v1/object/${bucket}/${path}`, {
        method: 'POST',
        headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': contentType, 'x-upsert': 'true' },
        body: bytes,
      });
      if (!res.ok) throw new AdminError(res.status, `storage upload: ${(await res.text()).slice(0, 200)}`);
    },
    /** Reads a file from a Storage bucket, as the service role; null when it is not there. */
    async download(bucket: string, path: string): Promise<Uint8Array | null> {
      const res = await fetch(`${url}/storage/v1/object/${bucket}/${path}`, {
        headers: { apikey: key, Authorization: `Bearer ${key}` },
      });
      if (res.status === 404 || res.status === 400) return null;
      if (!res.ok) throw new AdminError(res.status, `storage download: ${(await res.text()).slice(0, 200)}`);
      return new Uint8Array(await res.arrayBuffer());
    },
    deleteUser: (id: string) => request('DELETE', `/auth/v1/admin/users/${id}`),
    updateUser: (id: string, attributes: Record<string, unknown>) =>
      request('PUT', `/auth/v1/admin/users/${id}`, attributes),
  };
}
