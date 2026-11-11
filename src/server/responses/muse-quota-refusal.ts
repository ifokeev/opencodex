/**
 * Muse Code subscription quota refusals must not park a client for the whole
 * window. Meta answers 429 with `retry-after` set to the seconds left in the
 * five-hour window (often 30-40 minutes). Codex App honours that header and
 * schedules its next attempt at the reset time, which looks like a hung turn:
 * `stream disconnected - retrying sampling request (1/5 in 2248s)`.
 *
 * The refusal itself is useful: it names the reset instant. Only the long delay
 * is dropped, so the client follows its own short backoff and surfaces the
 * message instead of waiting out the window.
 */

/** Anything longer than this is a window reset, not a transient throttle. */
const LONG_RETRY_AFTER_SECONDS = 60;

/** The only route that answers with a Muse Code subscription refusal. */
const MUSE_SUBSCRIPTION_PROVIDER = "meta-muse";

export async function rewriteMuseQuotaExhaustedResponse(
  response: Response,
  provider?: string,
): Promise<Response> {
  if (provider !== undefined && provider !== MUSE_SUBSCRIPTION_PROVIDER) return response;
  if (response.status !== 429) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) return response;
  const retryAfter = Number(response.headers.get("retry-after"));
  if (!Number.isFinite(retryAfter) || retryAfter <= LONG_RETRY_AFTER_SECONDS) return response;

  let text: string;
  try {
    // Consume the refusal: an error body this small is never replayed downstream.
    text = await response.text();
  } catch {
    return response;
  }
  const headers = new Headers(response.headers);
  if (text.includes("Subscription quota exhausted")) {
    headers.delete("retry-after");
    headers.set("x-opencodex-quota-window-exhausted", "1");
  }
  return new Response(text, { status: response.status, statusText: response.statusText, headers });
}

