// Nested file under `server/nested/` — exercises the walker's
// recursion step and also adds a second missing package so the
// audit's sort-and-dedupe logic is tested.
import puppeteer from "puppeteer";
export function x(): void {
  void puppeteer;
}
