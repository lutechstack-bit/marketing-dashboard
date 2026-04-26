// Calendly client — fetches recent scheduled events + their invitees,
// indexes by lowercase invitee email so we can answer "did this lead book an interview?"
//
// Caching strategy: Next.js unstable_cache wraps the fetch so first load takes
// ~10s but subsequent loads within 5 min are instant. Stale-while-revalidate.
//
// API docs: https://developer.calendly.com/api-docs/

import { unstable_cache } from "next/cache";

const CAL_API = "https://api.calendly.com";
const TOKEN = process.env.CALENDLY_TOKEN || "";
const ORG_URI = process.env.CALENDLY_ORG_URI || "";

// Map Calendly event type name → program code in our DB.
// Note: some event names have trailing spaces in Calendly — we trim before lookup.
export const EVENT_TO_PROGRAM: Record<string, string> = {
  "the Forge Filmmaking Interview":                  "FFM",
  "the Forge Writing Interview":                     "FW",
  "the Forge Creators Interview":                    "FC",
  "the Forge AI Interview":                          "FAI",
  "The Breakthrough Filmmakers' Program Interview":  "BFP",
  "Video Editing Academy- Interview":                "VE",
  "LevelUp UI/UX Academy- Interview":                "L3-UX",
  "the LevelUp Creator Academy Interview":           "L3C",
  "The LevelUp Screenwriting Program":               "SW101",
};

export type CalendlyBooking = {
  event_uri: string;
  event_name: string;
  program: string | null;
  start_time: string;     // ISO
  end_time: string;       // ISO
  status: string;         // active | canceled
  invitee_email: string;
  invitee_name: string | null;
  created_at: string;
};

async function calGet(path: string): Promise<any> {
  const url = path.startsWith("http") ? path : `${CAL_API}${path}`;
  for (let i = 0; i < 3; i++) {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
    if (r.ok) return r.json();
    if ([429, 500, 502, 503, 504].includes(r.status) && i < 2) {
      await new Promise(res => setTimeout(res, 800 * (2 ** i))); continue;
    }
    throw new Error(`Calendly ${r.status}: ${await r.text()}`);
  }
  throw new Error("Calendly retries exhausted");
}

/**
 * Cached bookings fetch — 5-min TTL. Use this from server components.
 * First page load: ~10s. Subsequent loads: <100ms (cache hit).
 */
export const fetchBookingsCached = unstable_cache(
  async (daysBack: number = 45) => fetchBookings(daysBack),
  ["calendly-bookings"],
  { revalidate: 300, tags: ["calendly"] },
);

/**
 * Fetch all bookings for the org, going back N days from now (default 90).
 * Includes both upcoming and past events with status=active OR canceled.
 * Returns flat list of bookings (one per invitee).
 *
 * Use fetchBookingsCached() in server components for caching.
 */
export async function fetchBookings(daysBack = 90, hardCap = 1500): Promise<CalendlyBooking[]> {
  if (!TOKEN || !ORG_URI) return []; // graceful no-op if env not set

  const since = new Date(Date.now() - daysBack * 86400_000).toISOString();
  const out: CalendlyBooking[] = [];

  // 1) Page through scheduled events (active + canceled)
  for (const status of ["active", "canceled"] as const) {
    let url: string | null =
      `${CAL_API}/scheduled_events?organization=${encodeURIComponent(ORG_URI)}` +
      `&min_start_time=${encodeURIComponent(since)}&count=100&status=${status}&sort=start_time:desc`;
    while (url) {
      const data: any = await calGet(url);
      const events: any[] = data.collection || [];

      // 2) For each event, fetch invitees in parallel (capped concurrency)
      const PAR = 6;
      for (let i = 0; i < events.length; i += PAR) {
        const slice = events.slice(i, i + PAR);
        const results = await Promise.all(slice.map(async (e: any) => {
          try {
            const inv: any = await calGet(`${e.uri}/invitees`);
            return { event: e, invitees: inv.collection || [] };
          } catch {
            return { event: e, invitees: [] };
          }
        }));
        for (const { event, invitees } of results) {
          const program = EVENT_TO_PROGRAM[event.name?.trim() || ""] || null;
          for (const inv of invitees) {
            if (!inv.email) continue;
            out.push({
              event_uri: event.uri,
              event_name: event.name || "",
              program,
              start_time: event.start_time,
              end_time: event.end_time,
              status: inv.status || event.status,
              invitee_email: String(inv.email).toLowerCase(),
              invitee_name: inv.name || null,
              created_at: inv.created_at || event.created_at,
            });
            if (out.length >= hardCap) return out;
          }
        }
      }
      url = data.pagination?.next_page || null;
    }
  }
  return out;
}

/** Build email→bookings index for fast lookups in client code. */
export function indexByEmail(bookings: CalendlyBooking[]): Record<string, CalendlyBooking[]> {
  const idx: Record<string, CalendlyBooking[]> = {};
  for (const b of bookings) {
    const k = (b.invitee_email || "").toLowerCase();
    if (!k) continue;
    (idx[k] ||= []).push(b);
  }
  return idx;
}

/** Has this email booked any active (non-canceled) interview? */
export function hasActiveBooking(bookings: CalendlyBooking[] | undefined): boolean {
  if (!bookings) return false;
  return bookings.some(b => b.status !== "canceled");
}
