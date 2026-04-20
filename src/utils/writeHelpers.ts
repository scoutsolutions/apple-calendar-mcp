/**
 * Write-operation helpers for Apple Calendar MCP v0.2.0+.
 * @module utils/writeHelpers
 */

/**
 * Build an AppleScript string expression that preserves newlines.
 *
 * AppleScript string literals cannot contain raw newlines. To represent
 * multi-line text, we split on newlines, escape each line, and join with
 * `& linefeed & `. The escape function stays strict (rejects all control
 * chars including \n) and is applied only to individual lines, which by
 * definition contain no newlines.
 *
 * Caller must pass the escape function (avoids circular import).
 *
 * @param text - Multi-line text (may contain \n, \r\n, \r)
 * @param escapeFn - The project's escapeForAppleScript function
 * @returns AppleScript expression like `"line 1" & linefeed & "line 2"`.
 *          Unquoted - caller embeds as an expression, not as `"${...}"`.
 * @throws Error if any individual line contains control chars other than
 *         those normalized out (CR/LF are handled here).
 */
export function buildMultilineAppleScript(text: string, escapeFn: (s: string) => string): string {
  // Normalize all newline forms to \n, then split
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");

  // Hard cap on line count to prevent a pathological input from building
  // a multi-megabyte AppleScript source. 500 lines is plenty for notes.
  if (lines.length > 500) {
    throw new Error(
      `Multi-line content exceeds 500 lines (got ${lines.length}). Trim before sending.`
    );
  }

  const parts = lines.map((line) => `"${escapeFn(line)}"`);
  if (parts.length === 1) return parts[0];
  return parts.join(" & linefeed & ");
}

/**
 * Simple stderr audit log for write operations.
 * MCP hosts capture stderr, so this creates a basic trail for incident review.
 */
export function auditLog(
  operation: string,
  details: Record<string, string | number | boolean | undefined>
): void {
  const timestamp = new Date().toISOString();
  const detailStr = Object.entries(details)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
    .join(" ");
  console.error(`[audit ${timestamp}] ${operation} ${detailStr}`);
}

/**
 * Per-session rate limit for destructive operations.
 *
 * In-process counter with a rolling 60-second window. Primarily a guardrail
 * against prompt-injected agent loops (e.g., malicious invite asks the AI
 * to call delete-event 500 times). Not a security boundary - a determined
 * attacker who controls the MCP process has already won.
 */
const throttleWindows = new Map<string, number[]>();

export function checkThrottle(key: string, maxPerMinute: number): void {
  const now = Date.now();
  const windowMs = 60_000;
  const hits = throttleWindows.get(key) ?? [];
  const recent = hits.filter((t) => now - t < windowMs);
  if (recent.length >= maxPerMinute) {
    throw new Error(
      `Rate limit exceeded for "${key}": ${maxPerMinute} operations per minute. Wait and retry.`
    );
  }
  recent.push(now);
  throttleWindows.set(key, recent);
}

/**
 * Check if the server is running in read-only mode.
 * Write tools will refuse if APPLE_CALENDAR_MCP_READ_ONLY is truthy.
 */
export function isReadOnlyMode(): boolean {
  const v = process.env.APPLE_CALENDAR_MCP_READ_ONLY;
  return v === "1" || v === "true" || v === "yes";
}
