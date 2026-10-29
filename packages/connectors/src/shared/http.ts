import type { PublishErrorCode } from "../types";

export class PlatformApiError extends Error {
  errorCode: PublishErrorCode;
  retryable: boolean;
  status?: number;

  constructor(message: string, errorCode: PublishErrorCode, retryable: boolean, status?: number) {
    super(message);
    this.name = "PlatformApiError";
    this.errorCode = errorCode;
    this.retryable = retryable;
    this.status = status;
  }
}

/** Maps a raw HTTP status to a reasonable default error code/retryability. */
export function classifyHttpStatus(status: number): { errorCode: PublishErrorCode; retryable: boolean } {
  if (status === 401 || status === 403) {
    return { errorCode: "TOKEN_EXPIRED", retryable: false };
  }
  if (status === 429) {
    return { errorCode: "RATE_LIMITED", retryable: true };
  }
  if (status >= 500) {
    return { errorCode: "UNKNOWN", retryable: true };
  }
  if (status === 400 || status === 422) {
    return { errorCode: "VALIDATION_ERROR", retryable: false };
  }
  return { errorCode: "UNKNOWN", retryable: false };
}

interface JsonRequestOptions extends RequestInit {
  bearerToken?: string;
}

/**
 * Thin fetch wrapper shared by every connector: attaches a bearer token,
 * parses JSON, and throws a normalized PlatformApiError on non-2xx so worker
 * job handlers can catch one error type across all 9 platforms.
 */
export async function jsonRequest<T = unknown>(url: string, options: JsonRequestOptions = {}): Promise<T> {
  const { bearerToken, headers, ...rest } = options;
  const response = await fetch(url, {
    ...rest,
    headers: {
      ...(bearerToken ? { Authorization: `Bearer ${bearerToken}` } : {}),
      ...headers,
    },
  });

  const text = await response.text();
  const body = text ? safeJsonParse(text) : undefined;

  if (!response.ok) {
    const { errorCode, retryable } = classifyHttpStatus(response.status);
    const extracted = body && typeof body === "object" ? extractErrorMessage(body) : undefined;
    const message = extracted ?? `Request failed with status ${response.status}`;
    throw new PlatformApiError(message, errorCode, retryable, response.status);
  }

  return body as T;
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function extractErrorMessage(body: object): string | undefined {
  const record = body as Record<string, unknown>;
  if (typeof record.error === "string") return record.error;
  if (record.error && typeof record.error === "object") {
    const err = record.error as Record<string, unknown>;
    if (typeof err.message === "string") return err.message;
  }
  if (typeof record.message === "string") return record.message;
  return undefined;
}
