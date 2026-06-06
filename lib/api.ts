export class ApiError extends Error {
  status: number; code?: string; body?: unknown;
  constructor(status: number, message: string, code?: string, body?: unknown) {
    super(message); this.name = 'ApiError'; this.status = status; this.code = code; this.body = body;
  }
}
export async function apiFetch<T>(path: string, opts: { method?: string; json?: unknown } = {}): Promise<T> {
  const res = await fetch(path, {
    method: opts.method ?? 'GET',
    headers: opts.json !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: opts.json !== undefined ? JSON.stringify(opts.json) : undefined,
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, body?.error ?? res.statusText, body?.type, body);
  return body as T;
}
export function qs(params: Record<string, string | number | undefined | null>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString(); return s ? `?${s}` : '';
}
