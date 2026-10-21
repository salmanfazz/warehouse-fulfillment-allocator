import { TIME } from '@/config';
import { formatWib } from '@/domain/time';

// What the "ordered at" field shows by default: the current time on the WIB wall clock, as a
// datetime-local value ("2026-10-21T10:15"). It is built from UTC arithmetic, so it does not
// depend on the time zone of the browser.
export function currentWibInput(nowMs: number = Date.now()): string {
  return formatWib(nowMs).slice(0, 16);
}

const WITHOUT_ZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;

// The field means WIB, so a value without a zone gets the WIB offset. An empty field means
// "now" and is left out of the request. Anything else is passed on for the server to judge.
export function orderedAtFromInput(value: string): string | undefined {
  const text = value.trim();
  if (!text) return undefined;
  if (!WITHOUT_ZONE.test(text)) return text;
  const withSeconds = text.length === 16 ? `${text}:00` : text;
  return `${withSeconds}+${String(TIME.wibOffsetHours).padStart(2, '0')}:00`;
}
