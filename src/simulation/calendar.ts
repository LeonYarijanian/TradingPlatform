import { MARKET_HOLIDAYS, SESSION_MINUTES } from '../data/demoRun';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export interface CalendarDay {
  index: number;
  date: string;
  label: string;
  weekday: string;
  shortDate: string;
}

function parseIso(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function toIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function describeDate(iso: string, index = 0): CalendarDay {
  const d = parseIso(iso);
  const weekday = WEEKDAYS[d.getUTCDay()];
  const shortDate = `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
  return { index, date: iso, weekday, shortDate, label: `${weekday} ${shortDate}` };
}

/** Builds `count` consecutive trading days starting at `startIso` (skips weekends + holidays). */
export function buildTradingCalendar(startIso: string, count: number, holidays: Set<string> = MARKET_HOLIDAYS): CalendarDay[] {
  const days: CalendarDay[] = [];
  const cursor = parseIso(startIso);
  while (days.length < count) {
    const dow = cursor.getUTCDay();
    const iso = toIso(cursor);
    if (dow !== 0 && dow !== 6 && !holidays.has(iso)) days.push(describeDate(iso, days.length));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

const minuteOfDay = (minute: number) => (((9 * 60 + 30 + Math.floor(minute)) % 1440) + 1440) % 1440;

/** Session minute (0 = 9:30; live clocks may run outside the session) → "9:43" */
export function formatSessionTime(minute: number): string {
  const total = minuteOfDay(minute);
  const h = Math.floor(total / 60);
  const m = total % 60;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m.toString().padStart(2, '0')}`;
}

/** Session minute → "2:38 AM" — the wall clock for live mode, where any hour is possible. */
export function formatEtClock(minute: number): string {
  const total = minuteOfDay(minute);
  return `${formatSessionTime(minute)} ${total < 720 ? 'AM' : 'PM'}`;
}

/** Session minute → "12:00" in 24h-ish market style used by the chart header. */
export function formatClock24(minute: number): string {
  const total = 9 * 60 + 30 + Math.floor(Math.max(0, Math.min(SESSION_MINUTES, minute)));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${h}:${m.toString().padStart(2, '0')}`;
}
