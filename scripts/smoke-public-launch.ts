interface JsonResponse {
  ok?: boolean;
  errorCode?: string;
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

function normalizeBaseUrl(raw: string): string {
  const url = new URL(raw);
  const allowHttp = parseBoolean(process.env.PUBLIC_ALLOW_HTTP, false);
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

async function main(): Promise<void> {
  const baseUrl = normalizeBaseUrl(requireEnv("PUBLIC_BASE_URL"));
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

  const allowedOrigin = process.env.PUBLIC_ALLOWED_ORIGIN?.trim();
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
    if (allowedPreflight.headers.get("access-control-allow-origin") !== allowedOrigin) {
      throw new Error("Allowed origin preflight did not echo the configured origin");
    }
    checks.push("cors.allowed_origin");

    const blockedOrigin =
      process.env.PUBLIC_BLOCKED_ORIGIN?.trim() || "https://blocked-origin.example";
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

  const loginEmail = process.env.PUBLIC_LOGIN_EMAIL?.trim();
  const loginPassword = process.env.PUBLIC_LOGIN_PASSWORD?.trim();
  if ((loginEmail && !loginPassword) || (!loginEmail && loginPassword)) {
    throw new Error("PUBLIC_LOGIN_EMAIL and PUBLIC_LOGIN_PASSWORD must be set together");
  }

  if (loginEmail && loginPassword) {
    const login = await expectJson({
      url: `${baseUrl}/api/auth/login`,
      expectedStatus: 200,
      init: {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          email: loginEmail,
          password: loginPassword,
        }),
      },
    });
    const cookie = login.response.headers.get("set-cookie") ?? "";
    if (!/rm_session=/.test(cookie) || !/HttpOnly/i.test(cookie) || !/Secure/i.test(cookie)) {
      throw new Error("Login response did not include a hardened session cookie");
    }
    checks.push("auth.secure_cookie");

    const me = await expectJson({
      url: `${baseUrl}/api/auth/me`,
      expectedStatus: 200,
      init: {
        headers: {
          cookie,
        },
      },
    });
    if (me.body.ok !== true) {
      throw new Error("/api/auth/me did not return ok=true after login");
    }
    checks.push("auth.session_me");
  }

  const result: LaunchSmokeResult = {
    event: "public_launch_smoke.passed",
    baseUrl,
    checks,
  };
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(result));
}

void main();
