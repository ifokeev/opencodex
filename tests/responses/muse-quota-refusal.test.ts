import { describe, expect, test } from "bun:test";
import { rewriteMuseQuotaExhaustedResponse } from "../../src/server/responses/muse-quota-refusal";

const QUOTA_MESSAGE =
  "Subscription quota exhausted. Your usage window resets at 2026-11-16T00:00:00Z.";

function refusal(options: {
  retryAfter?: string;
  message?: string;
  contentType?: string;
  status?: number;
} = {}): Response {
  const headers = new Headers({ "content-type": options.contentType ?? "application/json" });
  if (options.retryAfter !== undefined) headers.set("retry-after", options.retryAfter);
  return new Response(JSON.stringify({
    error: {
      code: "rate_limit_exceeded",
      message: options.message ?? QUOTA_MESSAGE,
      param: null,
      resets_at: 1794787200,
      type: "rate_limit_error",
    },
  }), { status: options.status ?? 429, headers });
}

describe("Muse quota refusal", () => {
  test("drops a window-length retry-after on the subscription route", async () => {
    const response = await rewriteMuseQuotaExhaustedResponse(refusal({ retryAfter: "2248" }), "meta-muse");
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBeNull();
    expect(response.headers.get("x-opencodex-quota-window-exhausted")).toBe("1");
    expect(await response.text()).toContain("Subscription quota exhausted");
  });

  test("leaves another provider's matching refusal alone", async () => {
    const response = refusal({ retryAfter: "2248" });
    expect(await rewriteMuseQuotaExhaustedResponse(response, "meta-model")).toBe(response);
  });

  test("leaves a short retry-after alone", async () => {
    const response = refusal({ retryAfter: "30" });
    expect(await rewriteMuseQuotaExhaustedResponse(response, "meta-muse")).toBe(response);
  });

  test("leaves a long retry-after on a non-quota refusal alone", async () => {
    const response = refusal({ retryAfter: "2248", message: "Slow down" });
    const rewritten = await rewriteMuseQuotaExhaustedResponse(response, "meta-muse");
    expect(rewritten.headers.get("retry-after")).toBe("2248");
    expect(await rewritten.text()).toContain("Slow down");
  });

  test("ignores responses that are not JSON 429 refusals", async () => {
    const notFound = refusal({ retryAfter: "2248", status: 404 });
    expect(await rewriteMuseQuotaExhaustedResponse(notFound, "meta-muse")).toBe(notFound);
    const sse = refusal({ retryAfter: "2248", contentType: "text/event-stream" });
    expect(await rewriteMuseQuotaExhaustedResponse(sse, "meta-muse")).toBe(sse);
  });

  test("still applies when the caller omits the provider", async () => {
    const response = await rewriteMuseQuotaExhaustedResponse(refusal({ retryAfter: "2248" }));
    expect(response.headers.get("retry-after")).toBeNull();
  });
});

