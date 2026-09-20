import { afterEach, describe, expect, mock, test } from "bun:test";
import { CODEX_RESPONSES_HTTP_URL } from "../../src/server/responses/codex-ws-request";
import { MIN_BOUNDED_CODEX_WS_BUN_VERSION } from "../../src/server/responses/ws-upstream";
import { InvalidProviderEgressError, PROVIDER_EGRESS_DIRECT } from "../../src/lib/provider-egress";
import { __resetEgressWebsocketDowngradeNotices, providerFetch } from "../../src/server/responses/fetch-helpers";
import { PROXY_ENV_KEYS } from "../../src/lib/proxy-env";
import type { OcxProviderConfig } from "../../src/types";

/**
 * The inference dispatch. Every Responses, Chat, compaction and continuation send reaches the
 * wire through `providerFetch`, so this is where a per-provider route has to be applied for a
 * model call rather than only for discovery.
 *
 * Each case asserts the proxy the request was actually pinned to. A test that only asserted a
 * 200 would pass with the route dropped entirely.
 */
const proxyKeys = PROXY_ENV_KEYS.flatMap(key => [key, key.toLowerCase()]);
const originalProxyEnv = Object.fromEntries(proxyKeys.map(key => [key, process.env[key]]));

afterEach(() => {
  for (const key of proxyKeys) {
    const previous = originalProxyEnv[key];
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  }
  __resetEgressWebsocketDowngradeNotices();
});

const TARGET = "https://api.provider.example/v1/responses";
const PROVIDER_PROXY = "http://provider-egress.example:8080";
const GLOBAL_PROXY = "http://global-egress.example:3128";

function captureDispatch(): { calls: Array<{ url: string; proxy: unknown }>; restore: () => void } {
  const calls: Array<{ url: string; proxy: unknown }> = [];
  const original = globalThis.fetch;
  const stub = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
      proxy: (init as { proxy?: unknown } | undefined)?.proxy,
    });
    return new Response('{"ok":true}', { status: 200, headers: { "content-type": "application/json" } });
  });
  globalThis.fetch = stub as unknown as typeof globalThis.fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

function provider(extra: Partial<OcxProviderConfig> = {}): OcxProviderConfig {
  return { adapter: "openai-responses", baseUrl: "https://api.provider.example/v1", ...extra } as OcxProviderConfig;
}

describe("per-provider egress on the inference dispatch", () => {
  test("a provider pinned to direct sends with the runtime's explicit direct connection", async () => {
    for (const key of proxyKeys) delete process.env[key];
    process.env.HTTPS_PROXY = GLOBAL_PROXY;
    const captured = captureDispatch();
    try {
      await providerFetch(provider({ proxy: PROVIDER_EGRESS_DIRECT }), undefined, { providerName: "vendor" })(
        TARGET, { method: "POST", body: "{}" },
      );
      // `false` rather than an absent option: absent falls back to HTTPS_PROXY, which is set.
      expect(captured.calls).toEqual([{ url: TARGET, proxy: false }]);
    } finally {
      captured.restore();
    }
  });

  test("a provider proxy reaches the dispatch instead of the global one", async () => {
    for (const key of proxyKeys) delete process.env[key];
    process.env.HTTPS_PROXY = GLOBAL_PROXY;
    const captured = captureDispatch();
    try {
      await providerFetch(provider({ proxy: PROVIDER_PROXY }), undefined, { providerName: "vendor" })(
        TARGET, { method: "POST", body: "{}" },
      );
      expect(captured.calls).toEqual([{ url: TARGET, proxy: `${PROVIDER_PROXY}/` }]);
    } finally {
      captured.restore();
    }
  });

  test("a provider that declares nothing dispatches with no proxy option at all", async () => {
    for (const key of proxyKeys) delete process.env[key];
    process.env.HTTPS_PROXY = GLOBAL_PROXY;
    const captured = captureDispatch();
    try {
      await providerFetch(provider(), undefined, { providerName: "vendor" })(TARGET, { method: "POST", body: "{}" });
      expect(captured.calls).toEqual([{ url: TARGET, proxy: undefined }]);
    } finally {
      captured.restore();
    }
  });

  test("the route is decided per destination, not once per provider", async () => {
    // One executor, two destinations: the bypass list names one of them. Resolving the route
    // when the wrapper was built instead of when the request is sent would give both the same
    // exit and the second assertion would fail.
    for (const key of proxyKeys) delete process.env[key];
    const captured = captureDispatch();
    const send = providerFetch(
      provider({ proxy: PROVIDER_PROXY, noProxy: "internal.example" }),
      undefined,
      { providerName: "vendor" },
    );
    try {
      await send(TARGET, { method: "POST", body: "{}" });
      await send("https://internal.example/v1/responses", { method: "POST", body: "{}" });
      expect(captured.calls.map(call => call.proxy)).toEqual([`${PROVIDER_PROXY}/`, false]);
    } finally {
      captured.restore();
    }
  });

  test("an explicit route moves the WebSocket fast lane onto HTTP rather than dialling past it", async () => {
    // The WebSocket upstream picks its proxy from the process environment when it dials, so it
    // cannot carry a per-provider route. Serving the turn over HTTP honours the operator's
    // choice; dialling anyway would send it out the global exit while the configuration says
    // otherwise. The downgrade is announced, because a transport change nobody asked for is
    // exactly the kind of substitution that must not be silent.
    for (const key of proxyKeys) delete process.env[key];
    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => { warnings.push(args.map(String).join(" ")); };
    const captured = captureDispatch();
    const streamingPost = { method: "POST", body: JSON.stringify({ stream: true }) } as const;
    try {
      const send = providerFetch(
        provider({ proxy: PROVIDER_PROXY }),
        MIN_BOUNDED_CODEX_WS_BUN_VERSION,
        { providerName: "vendor" },
      );
      await send(CODEX_RESPONSES_HTTP_URL, { ...streamingPost });
      await send(CODEX_RESPONSES_HTTP_URL, { ...streamingPost });
      expect(captured.calls.map(call => call.proxy)).toEqual([`${PROVIDER_PROXY}/`, `${PROVIDER_PROXY}/`]);
      // Announced once per provider per process, not once per request.
      expect(warnings.filter(line => line.includes("vendor"))).toHaveLength(1);
    } finally {
      captured.restore();
      console.warn = originalWarn;
    }
  });

  test("an explicit route is refused on a caller-supplied executor instead of being dropped", async () => {
    for (const key of proxyKeys) delete process.env[key];
    const executor = mock(async () => new Response(null, { status: 200 }));
    const configured = provider({ proxy: PROVIDER_PROXY }) as OcxProviderConfig & { fetch?: typeof globalThis.fetch };
    configured.fetch = executor as unknown as typeof globalThis.fetch;
    await expect(providerFetch(configured, undefined, { providerName: "vendor" })(
      TARGET, { method: "POST", body: "{}" },
    )).rejects.toThrow(InvalidProviderEgressError);
    expect(executor).not.toHaveBeenCalled();
  });

  test("a malformed egress value rejects the send rather than falling back to a route", async () => {
    for (const key of proxyKeys) delete process.env[key];
    process.env.HTTPS_PROXY = GLOBAL_PROXY;
    const captured = captureDispatch();
    try {
      await expect(providerFetch(provider({ proxy: "ftp://egress.example" }), undefined, { providerName: "vendor" })(
        TARGET, { method: "POST", body: "{}" },
      )).rejects.toThrow(InvalidProviderEgressError);
      expect(captured.calls).toEqual([]);
    } finally {
      captured.restore();
    }
  });
});
