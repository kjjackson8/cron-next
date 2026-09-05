// Turns a parsed schedule back into an English sentence. This lives apart
// from cron.ts because describing a schedule in prose is a much fuzzier
// problem than matching one against a date, and keeping the two apart means
// the matching logic never has to think about phrasing.

import type { CronSchedule } from './cron.js';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const DOW_NAMES = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
];

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

// Joins ["1", "2", "3"] into "1, 2 and 3" the way a person reads a list out
// loud, instead of a raw comma-separated dump.
function joinWords(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

// Every field this tool parses stores its values sorted ascending, so a
// "run" is any prefix that increases by the same amount each step: that
// covers both a contiguous range (step 1) and a `*/N` or `A-B/N` step.
function detectRun(values: number[]): number | null {
  if (values.length < 2) return null;
  const step = (values[1] as number) - (values[0] as number);
  if (step <= 0) return null;
  for (let i = 1; i < values.length; i++) {
    if ((values[i] as number) - (values[i - 1] as number) !== step) return null;
  }
  return step;
}

function describeCounted(
  values: number[],
  singular: string,
  plural: string,
  format: (n: number) => string = String,
): string {
  const first = format(values[0] as number);
  if (values.length === 1) return `${singular} ${first}`;

  const last = format(values[values.length - 1] as number);
  const step = detectRun(values);
  if (step === 1) return `${plural} ${first} through ${last}`;
  if (step !== null) return `every ${step} ${plural} from ${first} through ${last}`;
  return `${plural} ${joinWords(values.map(format))}`;
}

function describeNamed(values: number[], nameOf: (n: number) => string): string {
  const named = values.map(nameOf);
  if (named.length === 1) return named[0] as string;

  const step = detectRun(values);
  const first = named[0] as string;
  const last = named[named.length - 1] as string;
  if (step === 1) return `${first} through ${last}`;
  if (step !== null) return `every ${step} from ${first} through ${last}`;
  return joinWords(named);
}

function describeTime(hours: number[], minutes: number[]): string {
  const allHours = hours.length === 24;
  const allMinutes = minutes.length === 60;

  if (allHours && allMinutes) return 'every minute';
  if (allMinutes) return `every minute during ${describeCounted(hours, 'hour', 'hours')}`;
  if (allHours) return `at ${describeCounted(minutes, 'minute', 'minutes')} past every hour`;

  // Any two values trivially form a "run", so only treat a field as a range
  // worth phrasing that way (e.g. "hours 9 through 17") once it has at
  // least three values; otherwise a handful of discrete values reads better
  // spelled out as clock times.
  const hourIsRange = hours.length >= 3 && detectRun(hours) !== null;
  const minuteIsRange = minutes.length >= 3 && detectRun(minutes) !== null;

  if (!hourIsRange && !minuteIsRange && hours.length * minutes.length <= 12) {
    const times = hours.flatMap((h) => minutes.map((m) => `${pad2(h)}:${pad2(m)}`));
    return `at ${joinWords(times)}`;
  }

  if (minutes.length === 1) {
    return `at minute ${minutes[0]} during ${describeCounted(hours, 'hour', 'hours')}`;
  }
  if (hours.length === 1) {
    return `at ${describeCounted(minutes, 'minute', 'minutes')} past hour ${hours[0]}`;
  }

  return `at ${describeCounted(minutes, 'minute', 'minutes')} during ${describeCounted(
    hours,
    'hour',
    'hours',
  )}`;
}

function describeDays(schedule: CronSchedule): string {
  const domClause = () =>
    `on ${describeCounted(Array.from(schedule.domSet), 'day', 'days', ordinal)} of the month`;
  const dowClause = () => `on ${describeNamed(Array.from(schedule.dowSet), (n) => DOW_NAMES[n] as string)}`;

  if (schedule.domRestricted && schedule.dowRestricted) return `${domClause()}, or ${dowClause()}`;
  if (schedule.domRestricted) return domClause();
  if (schedule.dowRestricted) return dowClause();
  return 'every day';
}

/** Renders a parsed schedule as a plain-English sentence, e.g. "Runs at
 * every 15 minutes from 0 through 45 during hours 9 through 17, on Monday
 * through Friday." */
export function explainCron(schedule: CronSchedule): string {
  const clauses = [describeTime(schedule.hours, schedule.minutes), describeDays(schedule)];

  if (schedule.months.size !== 12) {
    clauses.push(`in ${describeNamed(Array.from(schedule.months), (m) => MONTH_NAMES[m - 1] as string)}`);
  }

  return `Runs ${clauses.join(', ')}.`;
}
