/**
 * The only place this app talks to `window.arch`.
 *
 * Two properties matter, and neither survives ad-hoc calls scattered
 * across views:
 *
 * 1. **Serialization.** The extension answers one request at a time, and
 *    an interactive one (`connect`, `signArchMessageHash`) parks behind a
 *    popup the user has to finish. Firing a second request while the
 *    first is parked is how a single click ends up opening two wallet
 *    windows. Every call therefore queues behind the previous one.
 *
 * 2. **Coalescing.** A read the UI performs for its own reasons — the
 *    status probe on focus, say — must not multiply just because two
 *    components asked at once. Requests that carry a key share the
 *    in-flight promise instead of issuing a second round trip.
 *
 * Signature requests are deliberately un-keyed: two signatures in one
 * flow are two distinct approvals and must never be collapsed into one.
 *
 * The prompt that unlocks the wallet is the exception to both rules, and
 * `walletPrompt` below is why.
 */

/** Tail of the request queue; every new request chains onto it. */
let queue: Promise<unknown> = Promise.resolve();

/** Keyed requests currently running, so duplicates can ride along. */
const inFlight = new Map<string, Promise<unknown>>();

/** Ids issued to interactive prompts; the highest one is the live one. */
let latestPromptId = 0;

/**
 * Prompts still waiting on the user, each with the moment it stops
 * counting as open.
 *
 * The deadline is the part that matters. This flag used to be a bare
 * counter incremented before the provider call and decremented from the
 * promise's continuation — so a `connect()` that never settled left it
 * above zero for the life of the page. Anything that consulted it was
 * then permanently told "a prompt is open", which is how a wallet the
 * user had already unlocked stayed `locked` on screen forever.
 *
 * A prompt cannot outlive the injected provider's own request deadline
 * (120s), so anything older than that is not open — whatever happened to
 * its promise.
 */
const openPrompts = new Map<number, number>();

/** The provider's request deadline, plus slack for its own rejection. */
export const PROMPT_GUARD_MAX_MS = 130_000;

export function hasArchProvider(): boolean {
  return typeof window !== "undefined" && Boolean(window.arch);
}

/**
 * Run a wallet call after every previously queued one has settled.
 *
 * @param key Requests sharing a key de-duplicate while one is in flight.
 *   Pass `null` for calls that must always reach the wallet (signatures).
 */
export function walletRequest<T>(key: string | null, run: () => Promise<T>): Promise<T> {
  if (key) {
    const existing = inFlight.get(key) as Promise<T> | undefined;
    if (existing) return existing;
  }

  // `then(run, run)` rather than `then(run)`: a failed predecessor must
  // not cancel the requests queued behind it.
  const result = queue.then(run, run);
  const settled = () => undefined;
  queue = result.then(settled, settled);

  if (key) {
    inFlight.set(key, result);
    const release = () => {
      if (inFlight.get(key) === result) inFlight.delete(key);
    };
    void result.then(release, release);
  }
  return result;
}

export type WalletPromptHandle<T> = {
  /** Identifies this prompt, so a superseded answer can be discarded. */
  id: number;
  result: Promise<T>;
};

/**
 * Issue an interactive wallet request immediately, outside the queue.
 *
 * Two things go wrong when a prompt is queued like a read.
 *
 * The first is timing. `connect()` on a locked wallet does not resolve
 * and does not reject: the extension keeps the request pending and opens
 * its approval window, which renders Unlock first. That promise stays
 * open for as long as the user takes to find the window and type their
 * password — up to the provider's two-minute deadline. Anything chained
 * behind it is stalled for that whole time, including the status probe
 * that fires when the tab regains focus, which is exactly what coming
 * back from the wallet window looks like. The app went blind during the
 * one interval where it most needed to see, then drained a stale read
 * that overwrote whatever the prompt had just established.
 *
 * The second is coalescing. Sharing an in-flight `connect` means a
 * second click issues no provider call at all — so when the wallet
 * window opened behind the browser and the user clicked the button
 * again to find it, nothing happened.
 *
 * `run` is therefore called synchronously, before this function returns,
 * so the provider call leaves in the same turn as the click that asked
 * for it. Reads keep their own queue and flow past it; `getAccount()`
 * opens no window, so running one alongside a prompt costs nothing.
 */
export function walletPrompt<T>(run: () => Promise<T>): WalletPromptHandle<T> {
  const id = ++latestPromptId;
  openPrompts.set(id, Date.now() + PROMPT_GUARD_MAX_MS);
  const close = () => {
    openPrompts.delete(id);
  };
  let result: Promise<T>;
  try {
    result = run();
  } catch (error) {
    close();
    return { id, result: Promise.reject(error) };
  }
  // `Promise.resolve` rather than `result.then`: a provider that answers
  // synchronously — or with anything that is not a promise — must still
  // close its prompt rather than leaving the flag set for good.
  void Promise.resolve(result).then(close, close);
  return { id, result };
}

/**
 * True while the user still owes the wallet an answer.
 *
 * Expired prompts are dropped on read, so no caller can be told a prompt
 * is open for longer than one could actually be.
 */
export function isWalletPromptInFlight(): boolean {
  const now = Date.now();
  for (const [id, expiresAt] of openPrompts) {
    if (expiresAt <= now) openPrompts.delete(id);
  }
  return openPrompts.size > 0;
}

/**
 * False once a later prompt has been issued.
 *
 * A re-prompt supersedes the one before it: the old wallet window is
 * abandoned, and when it eventually closes it rejects a request nobody
 * is waiting on. Its answer must not be allowed to write state.
 */
export function isCurrentWalletPrompt(id: number): boolean {
  return id === latestPromptId;
}

/** Test-only: drop the queue and any in-flight keys between cases. */
export function __resetWalletGateway(): void {
  queue = Promise.resolve();
  inFlight.clear();
  latestPromptId = 0;
  openPrompts.clear();
}
