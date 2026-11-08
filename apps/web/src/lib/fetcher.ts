import { apiErrorSchema, type ApiErrorCode } from '@wb/shared';

export class ApiClientError extends Error {
  override readonly name = 'ApiClientError';
  constructor(
    public readonly status: number,
    public readonly code: ApiErrorCode,
    message: string,
  ) {
    super(message);
  }
}

/** Same-origin JSON fetch that turns the API error envelope into a typed exception. */
export async function apiFetch<T>(input: string, init?: RequestInit): Promise<T> {
  const res = await fetch(input, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    credentials: 'same-origin',
  });
  if (res.ok) {
    return (await res.json()) as T;
  }
  let code: ApiErrorCode = 'INTERNAL';
  let message = `Request failed (${res.status})`;
  try {
    const body = apiErrorSchema.safeParse(await res.json());
    if (body.success) {
      code = body.data.error.code;
      message = body.data.error.message;
    }
  } catch {
    // non-JSON error body
  }
  throw new ApiClientError(res.status, code, message);
}
