import { NextResponse } from "next/server";
import { prisma } from "@smm/db";
import { connectorRegistry } from "@smm/connectors";
import { encryptToken } from "@smm/auth";
import { getCurrentContext } from "@/lib/current-org";
import { oauthRedirectUri, parsePlatformParam } from "@/lib/platform-param";

export async function GET(request: Request, { params }: { params: { platform: string } }) {
  const ctx = await getCurrentContext();
  const platform = parsePlatformParam(params.platform);
  const redirectTo = (path: string) => NextResponse.redirect(new URL(path, request.url));

  if (!platform) {
    return redirectTo("/accounts?error=unknown_platform");
  }

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");
  const cookieName = `oauth_state_${platform}`;
  const expectedState = request.headers
    .get("cookie")
    ?.split("; ")
    .find((c) => c.startsWith(`${cookieName}=`))
    ?.split("=")[1];

  if (oauthError) {
    return redirectTo(`/accounts?error=${encodeURIComponent(oauthError)}`);
  }
  if (!code || !state || !expectedState || state !== expectedState) {
    return redirectTo("/accounts?error=invalid_oauth_state");
  }

  const connector = connectorRegistry.get(platform);
  try {
    const result = await connector.handleOAuthCallback(code, oauthRedirectUri(platform), state);

    await prisma.socialAccount.upsert({
      where: {
        organizationId_platform_externalUserId: {
          organizationId: ctx.organizationId,
          platform,
          externalUserId: result.externalUserId,
        },
      },
      create: {
        organizationId: ctx.organizationId,
        platform,
        displayName: result.displayName,
        handle: result.handle,
        avatarUrl: result.avatarUrl,
        externalUserId: result.externalUserId,
        accessToken: encryptToken(result.accessToken),
        refreshToken: result.refreshToken ? encryptToken(result.refreshToken) : null,
        tokenExpiresAt: result.expiresAt,
        scopes: result.scopes,
        status: "ACTIVE",
        metadata: (result.metadata as object) ?? undefined,
        connectedBy: ctx.userId,
      },
      update: {
        displayName: result.displayName,
        handle: result.handle,
        avatarUrl: result.avatarUrl,
        accessToken: encryptToken(result.accessToken),
        refreshToken: result.refreshToken ? encryptToken(result.refreshToken) : null,
        tokenExpiresAt: result.expiresAt,
        scopes: result.scopes,
        status: "ACTIVE",
        lastError: null,
        metadata: (result.metadata as object) ?? undefined,
      },
    });

    const response = redirectTo("/accounts?connected=" + platform.toLowerCase());
    response.cookies.delete(cookieName);
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const response = redirectTo(`/accounts?error=${encodeURIComponent(message)}`);
    response.cookies.delete(cookieName);
    return response;
  }
}
