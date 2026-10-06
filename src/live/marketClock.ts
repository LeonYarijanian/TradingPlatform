/**
 * Wall-clock ↔ trading-session math for live mode (US equities, America/New_York).
 *
 * The UI addresses time as (dayIndex, minute) where minute 0 is 9:30 ET and
 * dayIndex counts trading sessions from the live start date. Live events can
 * land outside the session (overnight futures, after-hours fills), so minutes
 * here are not clamped; `chartTimestamp` clamps only where a chart needs it.
 */
import { SESSION_MINUTES } from '../data/demoRun';
import { describeDate, type CalendarDay } from '../simulation/calendar';

export const ET_ZONE = 'America/New_York';
/** 9:30 ET as minutes after midnight. */
export const OPEN_MINUTE_OF_DAY = 9 * 60 + 30;

/** NYSE full-day closures, 2026–2027. */
export const NYSE_HOLIDAYS = new Set([
  '2026-01-01',
  '2026-01-19',
  '2026-02-16',
  '2026-04-03',
  '2026-05-25',
  '2026-06-19',
  '2026-07-03',
  '2026-09-07',
  '2026-11-26',
  '2026-12-25',
  '2027-01-01',
  '2027-01-18',
  '2027-02-15',
  '2027-03-26',
  '2027-05-31',
  '2027-06-18',
  '2027-07-05',
  '2027-09-06',
  '2027-11-25',
  '2027-12-24',
]);

/** 1:00 PM ET early closes. */
export const NYSE_EARLY_CLOSES = new Set(['2026-11-27', '2026-12-24', '2027-11-26']);

let partsFormatter: Intl.DateTimeFormat | null = null;

export interface EtTime {
  /** ET calendar date, YYYY-MM-DD. */
  date: string;
  /** Fractional minutes after ET midnight. */
  minuteOfDay: number;
}

/** Epoch ms → ET date + minute of day. */
export function toEt(ms: number): EtTime {
  partsFormatter ??= new Intl.DateTimeFormat('en-US', {
    timeZone: ET_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const parts: Record<string, string> = {};
  for (const p of partsFormatter.formatToParts(new Date(ms))) parts[p.type] = p.value;
  const hour = Number(parts.hour) % 24;
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minuteOfDay: hour * 60 + Number(parts.minute) + Number(parts.second) / 60,
  };
}

function isoToUtcMidnight(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function shiftIso(iso: string, days: number): string {
  return new Date(isoToUtcMidnight(iso) + days * 86_400_000).toISOString().slice(0, 10);
}

/** ET date + minute of day → epoch ms (DST-correct). */
export function etToUtcMs(date: string, minuteOfDay: number): number {
  const naive = isoToUtcMidnight(date) + minuteOfDay * 60_000;
  let guess = naive + 5 * 3_600_000;
  for (let i = 0; i < 3; i++) {
    const et = toEt(guess);
    const seen = isoToUtcMidnight(et.date) + Math.round(et.minuteOfDay * 60) * 1000;
    if (seen === naive) break;
    guess += naive - seen;
  }
  return guess;
}

export function isTradingDay(iso: string): boolean {
  const dow = new Date(isoToUtcMidnight(iso)).getUTCDay();
  return dow !== 0 && dow !== 6 && !NYSE_HOLIDAYS.has(iso);
}

/** Session length in minutes for a trading date (390, or 210 on early closes). */
export function sessionLength(iso: string): number {
  return NYSE_EARLY_CLOSES.has(iso) ? 210 : SESSION_MINUTES;
}

export function previousTradingDay(iso: string): string {
  let d = shiftIso(iso, -1);
  while (!isTradingDay(d)) d = shiftIso(d, -1);
  return d;
}

export type SessionPhase = 'pre' | 'open' | 'post' | 'closed';

export interface LiveLocation {
  /** Session index relative to the live start (negative = before it). */
  dayIndex: number;
  /** Minutes since 9:30 ET of that session (unclamped; weekends run past 1440). */
  minute: number;
  /** ET date of the instant. */
  date: string;
  /** dayIndex·390 + minute clamped into that session, for chart placement. */
  timestamp: number;
}

/**
 * The live run's calendar: every trading session from `start` through the
 * last session on or before `today`.
 */
export class LiveCalendar {
  readonly days: CalendarDay[] = [];
  private readonly index = new Map<string, number>();

  constructor(
    readonly start: string,
    readonly today: string,
  ) {
    for (let d = start; d <= today; d = shiftIso(d, 1)) {
      if (!isTradingDay(d)) continue;
      this.index.set(d, this.days.length);
      this.days.push(describeDate(d, this.days.length));
    }
  }

  /** Index of the last session on or before `iso` (negative before the start). */
  dayIndexOf(iso: string): number {
    let d = iso;
    while (!isTradingDay(d)) d = shiftIso(d, -1);
    const known = this.index.get(d);
    if (known !== undefined) return known;
    if (d > this.today) {
      // After the calendar was built (the page stayed open past midnight).
      let n = this.days.length - 1;
      for (let c = shiftIso(this.today, 1); c <= d; c = shiftIso(c, 1)) if (isTradingDay(c)) n++;
      return n;
    }
    let n = 0;
    for (let c = d; c < this.start; c = shiftIso(c, 1)) if (isTradingDay(c)) n++;
    return -n;
  }

  /** Session date for an index (works for negative indexes too). */
  dateOf(dayIndex: number): string {
    if (dayIndex >= 0 && dayIndex < this.days.length) return this.days[dayIndex].date;
    let d = this.days.length ? this.days[this.days.length - 1].date : this.start;
    let i = this.days.length - 1;
    if (dayIndex < 0) {
      // Index -1 is the session before the start date, whether or not the start trades.
      d = this.start;
      i = 0;
    }
    while (i > dayIndex) {
      d = previousTradingDay(d);
      i--;
    }
    while (i < dayIndex) {
      d = shiftIso(d, 1);
      if (isTradingDay(d)) i++;
    }
    return d;
  }

  locate(ms: number): LiveLocation {
    const et = toEt(ms);
    const dayIndex = this.dayIndexOf(et.date);
    // Minutes since that session's 9:30 — a Saturday reads as Friday + 1440·n.
    const sessionDate = this.dateOf(dayIndex);
    const daysAfter = Math.round((isoToUtcMidnight(et.date) - isoToUtcMidnight(sessionDate)) / 86_400_000);
    const minute = daysAfter * 1440 + et.minuteOfDay - OPEN_MINUTE_OF_DAY;
    const clamped = Math.max(0, Math.min(SESSION_MINUTES, minute));
    return { dayIndex, minute, date: et.date, timestamp: dayIndex * SESSION_MINUTES + clamped };
  }

  /** Where the market is for an ET instant. */
  phase(ms: number): SessionPhase {
    const et = toEt(ms);
    if (!isTradingDay(et.date)) return 'closed';
    const m = et.minuteOfDay - OPEN_MINUTE_OF_DAY;
    if (m < 0) return 'pre';
    if (m < sessionLength(et.date)) return 'open';
    return 'post';
  }
}

/** Robinhood/IB timestamps → epoch ms (NaN when unparseable). */
export function parseTime(v: unknown): number {
  if (typeof v === 'number') return v > 1e12 ? v : v * 1000;
  if (typeof v !== 'string' || !v) return NaN;
  return Date.parse(v);
}
