import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { connectorRegistry } from "@smm/connectors";
import { getCurrentContext } from "@/lib/current-org";
import { oauthRedirectUri, parsePlatformParam } from "@/lib/platform-param";

export async function GET(request: Request, { params }: { params: { platform: string } }) {
  await getCurrentContext(); // ensures the user is signed in before starting an OAuth round-trip
  const platform = parsePlatformParam(params.platform);
  if (!platform) {
    return NextResponse.json({ error: "Unknown platform" }, { status: 404 });
  }

  const connector = connectorRegistry.get(platform);
  if (!connector.isConfigured()) {
    const url = new URL("/accounts", request.url);
    url.searchParams.set("error", `${platform}_not_configured`);
    return NextResponse.redirect(url);
  }

  const state = randomBytes(24).toString("base64url");
  const authUrl = connector.getAuthUrl(state, oauthRedirectUri(platform));

  const response = NextResponse.redirect(authUrl);
  response.cookies.set(`oauth_state_${platform}`, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });
  return response;
}
