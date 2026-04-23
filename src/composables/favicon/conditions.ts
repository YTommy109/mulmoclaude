// Pure predicates for the favicon resolver. Every function takes
// only its inputs — no global `Date`, no env, no network — so a test
// can pin an arbitrary moment and assert the branch deterministically.

// Night runs from 22:00 (inclusive) to 05:00 (exclusive). Chosen so a
// typical "I'm winding down" window (22–24) and a "still up" window
// (00–05) share the same deep-work indigo.
export function isLateNight(now: Date): boolean {
  const hour = now.getHours();
  return hour >= 22 || hour < 5;
}

// Morning covers 05:00–09:00 — the "before the inbox wins" window.
// Disjoint from `isLateNight`, so the two rules never both fire.
export function isMorning(now: Date): boolean {
  const hour = now.getHours();
  return hour >= 5 && hour < 9;
}

// Weekend fires only during waking hours so the late-night rule wins
// overnight on Fri→Sat (that's still "deep work", not "weekend vibes").
// Saturday = 6, Sunday = 0 per `Date.getDay()`.
export function isWeekend(now: Date): boolean {
  const day = now.getDay();
  const hour = now.getHours();
  const onWeekend = day === 0 || day === 6;
  const duringDay = hour >= 9 && hour < 22;
  return onWeekend && duringDay;
}

// Birthday match: context stores "MM-DD"; we compare to today in the
// caller's local clock. Returns false for any malformed input rather
// than throwing — the favicon must never crash on a typo.
export function isBirthday(now: Date, userBirthdayMMDD: string | null): boolean {
  if (!userBirthdayMMDD) return false;
  if (!/^\d{2}-\d{2}$/.test(userBirthdayMMDD)) return false;
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${month}-${day}` === userBirthdayMMDD;
}

// New Year window — Jan 1–3 inclusive. Short enough that it stays
// special; 3 days covers the common "holiday still going" case
// (especially in Japan).
export function isNewYear(now: Date): boolean {
  return now.getMonth() === 0 && now.getDate() >= 1 && now.getDate() <= 3;
}

// Christmas window — Dec 24–25. Eve + day.
export function isChristmas(now: Date): boolean {
  return now.getMonth() === 11 && (now.getDate() === 24 || now.getDate() === 25);
}

// Overloaded: server 1-minute load average divided by logical core
// count. A ratio > 0.9 means "nearly all cores saturated for a full
// minute". Null input (no data yet, or Windows) → the rule is off.
export function isOverloaded(cpuLoadRatio: number | null): boolean {
  if (cpuLoadRatio === null || !Number.isFinite(cpuLoadRatio)) return false;
  return cpuLoadRatio > 0.9;
}

// Many-unread threshold — tuned so a typical day with 1–3 sleepy
// tabs stays green, but a noisy ping storm bumps up to fuchsia.
export const MANY_UNREAD_THRESHOLD = 5;
export function isManyUnread(count: number): boolean {
  return Number.isFinite(count) && count >= MANY_UNREAD_THRESHOLD;
}

// Running-long threshold — anything past ~1 minute is a "real" run
// (code gen, long web searches) as opposed to a quick reply.
export const RUNNING_LONG_MS = 60 * 1000;
export function isRunningLong(runningSinceMs: number | null, now: Date): boolean {
  if (runningSinceMs === null) return false;
  const elapsed = now.getTime() - runningSinceMs;
  return Number.isFinite(elapsed) && elapsed >= RUNNING_LONG_MS;
}
