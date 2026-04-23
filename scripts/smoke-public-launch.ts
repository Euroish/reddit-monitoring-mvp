interface JsonResponse {
  ok?: boolean;
  errorCode?: string;
}

function assertHeaderValue(
  headers: Headers,
  headerName: string,
  expectedValue: string,
  context: string,
): void {
  const actual = headers.get(headerName);
  if (actual !== expectedValue) {
    throw new Error(`${context} expected ${headerName}=${expectedValue}, got ${actual ?? "<missing>"}`);
  }
}

function assertCredentialedCors(headers: Headers, origin: string, context: string): void {
  assertHeaderValue(headers, "access-control-allow-origin", origin, context);
  assertHeaderValue(headers, "access-control-allow-credentials", "true", context);
}

function assertCookieContains(cookie: string, fragment: RegExp, context: string): void {
  if (!fragment.test(cookie)) {
    throw new Error(`${context} cookie missing ${fragment}`);
  }
}

interface LaunchSmokeResult {
  event: string;
  baseUrl: string;
  checks: string[];
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) {
    return fallback;
  }
  if (["1", "true", "yes"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no"].includes(normalized)) {
    return false;
  }
  return fallback;
}

function normalizeBaseUrl(raw: string, env: LaunchSmokeEnv): string {
  const url = new URL(raw);
  const allowHttp = parseBoolean(env.PUBLIC_ALLOW_HTTP, false);
  if (!allowHttp && url.protocol !== "https:") {
    throw new Error(`PUBLIC_BASE_URL must use https; got ${url.protocol}`);
  }
  url.pathname = url.pathname.replace(/\/+$/, "");
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

async function expectJson(args: {
  url: string;
  init?: RequestInit;
  expectedStatus: number;
}): Promise<{ body: JsonResponse; response: Response }> {
  const response = await fetch(args.url, {
    redirect: "manual",
    ...args.init,
  });
  if (response.status !== args.expectedStatus) {
    throw new Error(`Expected ${args.expectedStatus} from ${args.url}, got ${response.status}`);
  }
  const body = (await response.json()) as JsonResponse;
  return { body, response };
}

async function expectStatus(args: {
  url: string;
  init?: RequestInit;
  expectedStatuses: number[];
}): Promise<Response> {
  const response = await fetch(args.url, {
    redirect: "manual",
    ...args.init,
  });
  if (!args.expectedStatuses.includes(response.status)) {
    throw new Error(
      `Expected one of ${args.expectedStatuses.join(", ")} from ${args.url}, got ${response.status}`,
    );
  }
  return response;
}

interface LaunchSmokeEnv {
  [key: string]: string | undefined;
}

export async function runPublicLaunchSmoke(env: LaunchSmokeEnv = process.env): Promise<LaunchSmokeResult> {
  const baseUrl = normalizeBaseUrl(requireEnvFrom(env, "PUBLIC_BASE_URL"), env);
  const checks: string[] = [];

  const health = await expectJson({
    url: `${baseUrl}/healthz`,
    expectedStatus: 200,
  });
  if (health.body.ok !== true) {
    throw new Error("/healthz did not return ok=true");
  }
  checks.push("healthz.public_ok");

  await expectStatus({
    url: `${baseUrl}/readyz`,
    expectedStatuses: [401, 403, 404],
  });
  checks.push("readyz.not_public");

  const allowedOrigin = env.PUBLIC_ALLOWED_ORIGIN?.trim();
  if (allowedOrigin) {
    const allowedPreflight = await expectStatus({
      url: `${baseUrl}/api/v1/trends/market`,
      expectedStatuses: [204],
      init: {
        method: "OPTIONS",
        headers: {
          origin: allowedOrigin,
          "access-control-request-method": "GET",
        },
      },
    });
    assertCredentialedCors(
      allowedPreflight.headers,
      allowedOrigin,
      "Allowed origin preflight",
    );
    checks.push("cors.allowed_origin");

    const blockedOrigin =
      env.PUBLIC_BLOCKED_ORIGIN?.trim() || "https://blocked-origin.example";
    const blocked = await expectJson({
      url: `${baseUrl}/api/v1/trends/market`,
      expectedStatus: 403,
      init: {
        headers: {
          origin: blockedOrigin,
        },
      },
    });
    if (blocked.body.errorCode !== "cors_origin_not_allowed") {
      throw new Error("Blocked origin did not return cors_origin_not_allowed");
    }
    checks.push("cors.blocked_origin");
  }

  const loginEmail = env.PUBLIC_LOGIN_EMAIL?.trim();
  const loginPassword = env.PUBLIC_LOGIN_PASSWORD?.trim();
  if ((loginEmail && !loginPassword) || (!loginEmail && loginPassword)) {
    throw new Error("PUBLIC_LOGIN_EMAIL and PUBLIC_LOGIN_PASSWORD must be set together");
  }

  if (loginEmail && loginPassword) {
    const loginHeaders: Record<string, string> = {
      "content-type": "application/json",
    };
    if (allowedOrigin) {
      loginHeaders.origin = allowedOrigin;
    }
    const login = await expectJson({
      url: `${baseUrl}/api/auth/login`,
      expectedStatus: 200,
      init: {
        method: "POST",
        headers: loginHeaders,
        body: JSON.stringify({
          email: loginEmail,
          password: loginPassword,
        }),
      },
    });
    const cookie = login.response.headers.get("set-cookie") ?? "";
    assertCookieContains(cookie, /rm_session=/, "Login response");
    assertCookieContains(cookie, /HttpOnly/i, "Login response");
    assertCookieContains(cookie, /Secure/i, "Login response");
    assertCookieContains(cookie, /SameSite=Lax/i, "Login response");
    checks.push("auth.secure_cookie");
    if (allowedOrigin) {
      assertCredentialedCors(login.response.headers, allowedOrigin, "Login response");
      checks.push("auth.login_cors_credentials");
    }

    const meHeaders: Record<string, string> = {
      cookie,
    };
    if (allowedOrigin) {
      meHeaders.origin = allowedOrigin;
    }
    const me = await expectJson({
      url: `${baseUrl}/api/auth/me`,
      expectedStatus: 200,
      init: {
        headers: meHeaders,
      },
    });
    if (me.body.ok !== true) {
      throw new Error("/api/auth/me did not return ok=true after login");
    }
    checks.push("auth.session_me");
    if (allowedOrigin) {
      assertCredentialedCors(me.response.headers, allowedOrigin, "/api/auth/me response");
      checks.push("auth.me_cors_credentials");
    }

    const logoutHeaders: Record<string, string> = {
      "content-type": "application/json",
      cookie,
    };
    if (allowedOrigin) {
      logoutHeaders.origin = allowedOrigin;
    }
    const logout = await expectJson({
      url: `${baseUrl}/api/auth/logout`,
      expectedStatus: 200,
      init: {
        method: "POST",
        headers: logoutHeaders,
        body: JSON.stringify({}),
      },
    });
    const clearCookie = logout.response.headers.get("set-cookie") ?? "";
    assertCookieContains(clearCookie, /rm_session=/, "Logout response");
    assertCookieContains(clearCookie, /Max-Age=0/i, "Logout response");
    assertCookieContains(clearCookie, /Secure/i, "Logout response");
    checks.push("auth.logout_clears_cookie");
    if (allowedOrigin) {
      assertCredentialedCors(logout.response.headers, allowedOrigin, "Logout response");
      checks.push("auth.logout_cors_credentials");
    }
  }

  return {
    event: "public_launch_smoke.passed",
    baseUrl,
    checks,
  };
}

function requireEnvFrom(env: LaunchSmokeEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

async function main(): Promise<void> {
  const result = await runPublicLaunchSmoke(process.env);
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(result));
}

if (require.main === module) {
  void main();
}
