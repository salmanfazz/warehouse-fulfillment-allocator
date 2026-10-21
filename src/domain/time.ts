import { ETA, TIME } from '@/config';
import type { Bucket, Day } from './types';

const MS_PER_HOUR = 60 * 60 * 1000;
const DAYS: Day[] = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']; // Date.getUTCDay() order

// YYYY-MM-DDTHH:mm[:ss[.fff]] followed by Z or +HH:MM / -HH:MM. The offset is required: without
// it the server's own time zone would silently decide what the time means.
const ORDERED_AT =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|([+-])(\d{2}):(\d{2}))$/;

function daysInMonth(year: number, month: number): number {
  const date = new Date(0);
  date.setUTCFullYear(year, month, 0); // day 0 of the next month is the last day of this one
  return date.getUTCDate();
}

// The one definition of a valid orderedAt. Date.parse is not used: it accepts 30 February
// (as 2 March) and reads a string without an offset in local time.
export function parseOrderedAt(iso: string): number {
  const match = ORDERED_AT.exec(iso);
  if (!match) throw new RangeError('orderedAt must be ISO 8601 with an offset');
  const [, y, mo, d, h, mi, s, sign, oh, om] = match;
  const [year, month, day, hour, minute, second] = [y, mo, d, h, mi, s ?? '0'].map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const offsetHours = Number(oh ?? 0);
  const offsetMinutes = Number(om ?? 0);
  const inRange =
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= daysInMonth(year, month) &&
    hour <= 23 &&
    minute <= 59 &&
    second <= 59 &&
    offsetHours <= 23 &&
    offsetMinutes <= 59;
  if (!inRange) throw new RangeError('orderedAt is not a real date and time');

  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, 0);
  const offset = (sign === '-' ? -1 : 1) * (offsetHours * 60 + offsetMinutes);
  const ms = date.getTime() - offset * 60 * 1000;
  // The WIB time we report back must still have a four-digit year (0001 to 9999).
  const wibYear = wibClock(ms).getUTCFullYear();
  if (wibYear < 1 || wibYear > 9999)
    throw new RangeError('orderedAt is out of the supported range');
  return ms;
}

export function isValidOrderedAt(iso: string): boolean {
  try {
    parseOrderedAt(iso);
    return true;
  } catch {
    return false;
  }
}

// "HH:MM" or "HH:MM:SS" to minutes since midnight. Seconds are dropped.
export function minutesOf(time: string): number {
  const match = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(time);
  const hours = Number(match?.[1]);
  const minutes = Number(match?.[2]);
  const seconds = Number(match?.[3] ?? 0);
  if (!match || hours > 23 || minutes > 59 || seconds > 59) {
    throw new RangeError(`Not a time of day: ${time}`);
  }
  return hours * 60 + minutes;
}

// Weekend any time; on weekdays peak inside the configured half-open windows.
export function bucketOf(day: Day, minutesSinceMidnight: number): Bucket {
  if (day === 'Sat' || day === 'Sun') return 'weekend';
  const inPeak = ETA.peakWindows.some(
    ([start, end]) => minutesSinceMidnight >= start && minutesSinceMidnight < end,
  );
  return inPeak ? 'peak' : 'off_peak';
}

// Shifting by the WIB offset and reading the UTC fields gives the WIB wall clock.
function wibClock(ms: number): Date {
  return new Date(ms + TIME.wibOffsetHours * MS_PER_HOUR);
}

export function toWib(ms: number): { day: Day; minutes: number; bucket: Bucket } {
  const clock = wibClock(ms);
  const day = DAYS[clock.getUTCDay()] as Day;
  const minutes = clock.getUTCHours() * 60 + clock.getUTCMinutes();
  return { day, minutes, bucket: bucketOf(day, minutes) };
}

// "2026-10-19T08:00:00+07:00": whole seconds, WIB offset.
export function formatWib(ms: number): string {
  const c = wibClock(ms);
  const two = (n: number) => String(n).padStart(2, '0');
  const date = `${String(c.getUTCFullYear()).padStart(4, '0')}-${two(c.getUTCMonth() + 1)}-${two(c.getUTCDate())}`;
  const time = `${two(c.getUTCHours())}:${two(c.getUTCMinutes())}:${two(c.getUTCSeconds())}`;
  return `${date}T${time}+${two(TIME.wibOffsetHours)}:00`;
}
