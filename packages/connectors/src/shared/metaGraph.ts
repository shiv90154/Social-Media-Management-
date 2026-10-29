import { jsonRequest } from "./http";

export const GRAPH_API_VERSION = "v19.0";
export const FACEBOOK_GRAPH_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;
export const THREADS_GRAPH_BASE = "https://graph.threads.net/v1.0";

/**
 * Shared request helper for the Meta Graph API family (Facebook Pages,
 * Instagram Graph API, Threads API). All three are REST+JSON over a Graph
 * API shape and accept the access token as an `access_token` query param.
 */
export async function graphRequest<T = unknown>(
  baseUrl: string,
  path: string,
  accessToken: string,
  init: { method?: "GET" | "POST" | "DELETE"; params?: Record<string, string>; body?: URLSearchParams } = {},
): Promise<T> {
  const url = new URL(`${baseUrl}${path}`);
  url.searchParams.set("access_token", accessToken);
  for (const [key, value] of Object.entries(init.params ?? {})) {
    url.searchParams.set(key, value);
  }
  return jsonRequest<T>(url.toString(), {
    method: init.method ?? "GET",
    body: init.body,
    headers: init.body ? { "Content-Type": "application/x-www-form-urlencoded" } : undefined,
  });
}

export interface FacebookPage {
  id: string;
  name: string;
  access_token: string;
  instagram_business_account?: { id: string };
}

/** Lists the Facebook Pages the authenticated user manages, with page access tokens. */
export async function listManagedPages(userAccessToken: string): Promise<FacebookPage[]> {
  const result = await graphRequest<{ data: FacebookPage[] }>(FACEBOOK_GRAPH_BASE, "/me/accounts", userAccessToken, {
    params: { fields: "id,name,access_token,instagram_business_account" },
  });
  return result.data;
}

/** Exchanges a short-lived Facebook user token for a long-lived one (~60 days). */
export async function exchangeForLongLivedToken(
  shortLivedToken: string,
  appId: string,
  appSecret: string,
): Promise<{ access_token: string; expires_in: number }> {
  const url = new URL(`${FACEBOOK_GRAPH_BASE}/oauth/access_token`);
  url.searchParams.set("grant_type", "fb_exchange_token");
  url.searchParams.set("client_id", appId);
  url.searchParams.set("client_secret", appSecret);
  url.searchParams.set("fb_exchange_token", shortLivedToken);
  return jsonRequest(url.toString());
}

/** Downloads a media file so its bytes can be re-uploaded to a platform's API. */
export async function fetchMediaBuffer(url: string): Promise<{ buffer: ArrayBuffer; contentType: string }> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download media from ${url}: ${response.status}`);
  }
  const buffer = await response.arrayBuffer();
  const contentType = response.headers.get("content-type") ?? "application/octet-stream";
  return { buffer, contentType };
}
