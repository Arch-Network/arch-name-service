import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";

const INDEXER_RPC_URL =
  "https://explorer.arch.network/api/v1/testnet/rpc";
const INDEXER_REST_BASE =
  "https://explorer.arch.network/api/v1/testnet";

const ALLOWED_RPC_METHODS = new Set([
  "create_account_with_faucet",
  "get_multiple_accounts",
  "get_program_accounts",
  "read_account_info",
  "send_transaction",
]);

/**
 * Same-origin REST proxy allowlist. Paths are relative to /api/v1/testnet/.
 * Write/admin/auth/faucet/bitcoin mutation surfaces are intentionally excluded.
 */
const ALLOWED_REST_PREFIXES = [
  "accounts/",
  "programs/",
  "search",
  "network/",
  "blocks/",
  "transactions/",
];

const secrets = new SecretsManagerClient({});

let cachedApiKey;

async function getApiKey() {
  if (cachedApiKey) return cachedApiKey;

  const response = await secrets.send(
    new GetSecretValueCommand({
      SecretId: process.env.INDEXER_API_KEY_SECRET_ARN,
    }),
  );
  if (!response.SecretString) {
    throw new Error("Indexer API key secret is empty");
  }
  cachedApiKey = response.SecretString;
  return cachedApiKey;
}

function response(statusCode, body, headers = {}) {
  return {
    statusCode,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json",
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  };
}

function requestPath(event) {
  const raw =
    event.rawPath ??
    event.path ??
    event.requestContext?.http?.path ??
    "";
  // API Gateway stage prefix e.g. /prod/rpc → /rpc
  return raw.replace(/^\/prod/, "") || raw;
}

function isAllowedRestPath(relativePath) {
  const normalized = relativePath.replace(/^\/+/, "");
  if (!normalized || normalized.includes("..") || normalized.includes("//")) {
    return false;
  }
  // Block query-string smuggling via path
  if (normalized.includes("?") || normalized.includes("#")) {
    return false;
  }
  return ALLOWED_REST_PREFIXES.some(
    (prefix) => normalized === prefix.replace(/\/$/, "") || normalized.startsWith(prefix),
  );
}

async function handleRpc(event) {
  let request;
  try {
    request = JSON.parse(event.body ?? "");
  } catch {
    return response(400, { error: "invalid_json" });
  }

  if (
    Array.isArray(request) ||
    request?.jsonrpc !== "2.0" ||
    typeof request?.method !== "string" ||
    !ALLOWED_RPC_METHODS.has(request.method)
  ) {
    return response(400, {
      error: "unsupported_rpc_request",
      message: "This proxy only accepts ANS manager RPC methods.",
    });
  }

  const upstream = await fetch(INDEXER_RPC_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${await getApiKey()}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(request),
  });

  return {
    statusCode: upstream.status,
    headers: {
      "cache-control": "no-store",
      "content-type":
        upstream.headers.get("content-type") ?? "application/json",
    },
    body: await upstream.text(),
  };
}

async function handleExplorerRest(event, method) {
  const path = requestPath(event);
  // /explorer/accounts/xyz → accounts/xyz
  const match = path.match(/^\/explorer\/(.*)$/);
  if (!match) {
    return response(404, { error: "not_found" });
  }
  const relative = match[1];
  if (!isAllowedRestPath(relative)) {
    return response(403, {
      error: "path_not_allowed",
      message: "This proxy only forwards allowlisted Explorer REST read paths.",
    });
  }

  // Strip abusive query keys; allow a small safe set used by list endpoints.
  const incoming = event.queryStringParameters ?? {};
  const allowedQuery = new Set([
    "limit",
    "page",
    "offset",
    "q",
    "cursor",
    "before",
    "after",
  ]);
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(incoming)) {
    if (!allowedQuery.has(key) || value == null) continue;
    // Cap length to blunt abuse
    const truncated = String(value).slice(0, 128);
    query.set(key, truncated);
  }
  const qs = query.toString();
  const upstreamUrl = `${INDEXER_REST_BASE}/${relative}${qs ? `?${qs}` : ""}`;

  const upstream = await fetch(upstreamUrl, {
    method,
    headers: {
      authorization: `Bearer ${await getApiKey()}`,
      accept: "application/json",
    },
  });

  return {
    statusCode: upstream.status,
    headers: {
      "cache-control": "no-store",
      "content-type":
        upstream.headers.get("content-type") ?? "application/json",
    },
    body: await upstream.text(),
  };
}

export async function handler(event) {
  const method = event.requestContext?.http?.method ?? event.httpMethod ?? "GET";
  const path = requestPath(event);

  if (path === "/rpc" || path.endsWith("/rpc")) {
    if (method !== "POST") {
      return response(405, { error: "method_not_allowed" });
    }
    return handleRpc(event);
  }

  if (path === "/explorer" || path.startsWith("/explorer/")) {
    if (method !== "GET" && method !== "HEAD") {
      return response(405, { error: "method_not_allowed" });
    }
    return handleExplorerRest(event, method);
  }

  return response(404, { error: "not_found" });
}
