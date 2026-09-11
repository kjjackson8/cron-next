// Parses standard 5-field cron expressions (minute hour day-of-month month
// day-of-week) and computes upcoming run times. No seconds field, no
// year field, no vixie-cron extensions like L, W or #. Field matching
// (minute, hour, day-of-month, day-of-week) is done against wall-clock
// values in the schedule's timezone, defaulting to UTC, so "0 9 * * *"
// means 9am local to whatever zone was requested, not 9am UTC.

export class CronParseError extends Error {}

export interface CronSchedule {
  minutes: number[];
  hours: number[];
  domSet: Set<number>;
  domRestricted: boolean;
  months: Set<number>;
  dowSet: Set<number>;
  dowRestricted: boolean;
  timezone: string;
}

const FIELD_NAMES = ['minute', 'hour', 'day-of-month', 'month', 'day-of-week'] as const;

const STEP_ONLY = /^\*\/(\d+)$/;
const RANGE_STEP = /^(\d+)-(\d+)\/(\d+)$/;
const RANGE_ONLY = /^(\d+)-(\d+)$/;
const SINGLE = /^(\d+)$/;

const MONTH_NAMES = [
  'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
  'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC',
];
const DOW_NAMES = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

// Cron lets month and day-of-week fields use three-letter names in place of
// numbers, anywhere a number would be valid (single values, ranges, and
// ranges with a step). Swapping names for numbers here means the rest of
// the parser never has to know names exist.
function substituteNames(
  spec: string,
  names: readonly string[],
  base: number,
  fieldName: string,
): string {
  return spec.replace(/[A-Za-z]+/g, (token) => {
    const index = names.indexOf(token.toUpperCase());
    if (index === -1) {
      throw new CronParseError(`unknown ${fieldName} name "${token}" in "${spec}"`);
    }
    return String(index + base);
  });
}

function parseField(spec: string, min: number, max: number, fieldName: string): number[] {
  const values = new Set<number>();

  for (const part of spec.split(',')) {
    if (part === '*') {
      for (let v = min; v <= max; v++) values.add(v);
      continue;
    }

    let match = part.match(STEP_ONLY);
    if (match) {
      addStepped(values, min, max, Number(match[1]), fieldName, part);
      continue;
    }

    match = part.match(RANGE_STEP);
    if (match) {
      const from = Number(match[1]);
      const to = Number(match[2]);
      const step = Number(match[3]);
      validateRange(from, to, min, max, fieldName, part);
      addStepped(values, from, to, step, fieldName, part);
      continue;
    }

    match = part.match(RANGE_ONLY);
    if (match) {
      const from = Number(match[1]);
      const to = Number(match[2]);
      validateRange(from, to, min, max, fieldName, part);
      for (let v = from; v <= to; v++) values.add(v);
      continue;
    }

    match = part.match(SINGLE);
    if (match) {
      const value = Number(match[1]);
      if (value < min || value > max) {
        throw new CronParseError(
          `${fieldName} field value ${value} out of range ${min}-${max} in "${spec}"`,
        );
      }
      values.add(value);
      continue;
    }

    throw new CronParseError(`invalid ${fieldName} field segment "${part}" in "${spec}"`);
  }

  return Array.from(values).sort((a, b) => a - b);
}

function addStepped(
  values: Set<number>,
  from: number,
  to: number,
  step: number,
  fieldName: string,
  part: string,
): void {
  if (step <= 0) {
    throw new CronParseError(`step must be a positive integer in "${part}" (${fieldName} field)`);
  }
  for (let v = from; v <= to; v += step) values.add(v);
}

function validateRange(
  from: number,
  to: number,
  min: number,
  max: number,
  fieldName: string,
  part: string,
): void {
  if (from < min || to > max || from > to) {
    throw new CronParseError(
      `invalid range "${part}" in ${fieldName} field (expected ${min}-${max}, low <= high)`,
    );
  }
}

function assertValidTimeZone(timezone: string): void {
  try {
    // Intl throws RangeError for a timezone name it doesn't recognize;
    // constructing the formatter is the only reliable way to validate one
    // without shipping our own copy of the IANA database.
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
  } catch {
    throw new CronParseError(`unknown timezone "${timezone}"`);
  }
}

export function parseCron(expression: string, timezone = 'UTC'): CronSchedule {
  assertValidTimeZone(timezone);

  const parts = expression.trim().split(/\s+/).filter((p) => p.length > 0);
  if (parts.length !== 5) {
    throw new CronParseError(
      `expected 5 fields (${FIELD_NAMES.join(' ')}), got ${parts.length} in "${expression}"`,
    );
  }

  const [minuteSpec, hourSpec, domSpec, monthSpec, dowSpec] = parts as [
    string,
    string,
    string,
    string,
    string,
  ];

  const minutes = parseField(minuteSpec, 0, 59, 'minute');
  const hours = parseField(hourSpec, 0, 23, 'hour');
  const domValues = parseField(domSpec, 1, 31, 'day-of-month');
  const monthValues = parseField(
    substituteNames(monthSpec, MONTH_NAMES, 1, 'month'),
    1,
    12,
    'month',
  );

  // Day-of-week accepts 0-7, where both 0 and 7 mean Sunday.
  const dowRaw = parseField(
    substituteNames(dowSpec, DOW_NAMES, 0, 'day-of-week'),
    0,
    7,
    'day-of-week',
  );
  const dowValues = Array.from(new Set(dowRaw.map((v) => (v === 7 ? 0 : v)))).sort(
    (a, b) => a - b,
  );

  return {
    minutes,
    hours,
    domSet: new Set(domValues),
    domRestricted: domSpec !== '*',
    months: new Set(monthValues),
    dowSet: new Set(dowValues),
    dowRestricted: dowSpec !== '*',
    timezone,
  };
}

function monthMatches(schedule: CronSchedule, date: Date): boolean {
  return schedule.months.has(date.getUTCMonth() + 1);
}

// Standard (and famously surprising) cron rule: when both day-of-month and
// day-of-week are restricted, a day matches if EITHER field matches, not
// both. When only one is restricted, that field alone decides.
function dayMatches(schedule: CronSchedule, date: Date): boolean {
  const domOk = schedule.domSet.has(date.getUTCDate());
  const dowOk = schedule.dowSet.has(date.getUTCDay());

  if (schedule.domRestricted && schedule.dowRestricted) return domOk || dowOk;
  if (schedule.domRestricted) return domOk;
  if (schedule.dowRestricted) return dowOk;
  return true;
}

function firstTimeOfDay(
  hours: number[],
  minutes: number[],
  minMinuteOfDay: number,
): { hour: number; minute: number } | null {
  for (const hour of hours) {
    for (const minute of minutes) {
      if (hour * 60 + minute >= minMinuteOfDay) return { hour, minute };
    }
  }
  return null;
}

// hours and minutes are sorted ascending, so the last time of day at or
// before maxMinuteOfDay is found by walking both from the end.
function lastTimeOfDay(
  hours: number[],
  minutes: number[],
  maxMinuteOfDay: number,
): { hour: number; minute: number } | null {
  for (let hi = hours.length - 1; hi >= 0; hi--) {
    const hour = hours[hi] as number;
    for (let mi = minutes.length - 1; mi >= 0; mi--) {
      const minute = minutes[mi] as number;
      if (hour * 60 + minute <= maxMinuteOfDay) return { hour, minute };
    }
  }
  return null;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

interface WallClockParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

// Reads the wall-clock date and time that a real instant corresponds to in
// a given timezone. This is the only piece of timezone knowledge the whole
// tool needs; everything else is built on top of it.
function wallClockOf(instant: Date, timeZone: string): WallClockParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value);
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
  };
}

// How far the timezone's clock is ahead of UTC at a given instant, in
// milliseconds. Varies across the year for zones that observe DST.
function offsetMsAt(instant: Date, timeZone: string): number {
  const w = wallClockOf(instant, timeZone);
  const asIfUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  return asIfUtc - instant.getTime();
}

// Represents a wall-clock date/time as a Date whose UTC getters give back
// those same fields, regardless of what timezone it actually describes.
// This lets nextRun's calendar arithmetic (month/day/day-of-week matching,
// stepping to the next civil day) stay identical whether the schedule runs
// in UTC or in some IANA zone: it only ever has to reason about "the civil
// calendar", never about real elapsed time.
function toCivil(instant: Date, timeZone: string): Date {
  if (timeZone === 'UTC') return instant;
  const w = wallClockOf(instant, timeZone);
  return new Date(Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second));
}

// The inverse of toCivil: given a wall-clock date/time meant for timeZone
// (packed into a Date's UTC fields), finds the real instant it refers to.
// Starts from a same-numbers-but-UTC guess, corrects it by that guess's
// offset, then re-checks the offset at the corrected instant in case the
// correction crossed a DST boundary.
function fromCivil(civil: Date, timeZone: string): Date {
  if (timeZone === 'UTC') return civil;
  const guess = civil.getTime();
  const offset = offsetMsAt(new Date(guess), timeZone);
  const corrected = guess - offset;
  const offset2 = offsetMsAt(new Date(corrected), timeZone);
  return new Date(offset2 === offset ? corrected : guess - offset2);
}

/**
 * Returns the next run time strictly after `from`, as a real instant (its
 * UTC value is always correct; only field matching happens in the
 * schedule's timezone). Searches day by day (fast even for constraints
 * like "Feb 29" that only occur every few years) and then picks the first
 * matching hour/minute within a matching day.
 */
export function nextRun(schedule: CronSchedule, from: Date, maxDays = 5 * 366): Date {
  const civilFrom = toCivil(from, schedule.timezone);
  const dayStart = Date.UTC(civilFrom.getUTCFullYear(), civilFrom.getUTCMonth(), civilFrom.getUTCDate());
  const startMinuteOfDay = civilFrom.getUTCHours() * 60 + civilFrom.getUTCMinutes() + 1;

  for (let i = 0; i <= maxDays; i++) {
    const candidate = new Date(dayStart + i * MS_PER_DAY);
    if (!monthMatches(schedule, candidate)) continue;
    if (!dayMatches(schedule, candidate)) continue;

    const minMinuteOfDay = i === 0 ? startMinuteOfDay : 0;
    const found = firstTimeOfDay(schedule.hours, schedule.minutes, minMinuteOfDay);
    if (found === null) continue;

    const civilResult = new Date(
      Date.UTC(
        candidate.getUTCFullYear(),
        candidate.getUTCMonth(),
        candidate.getUTCDate(),
        found.hour,
        found.minute,
      ),
    );
    return fromCivil(civilResult, schedule.timezone);
  }

  throw new Error(`no run found within ${maxDays} days of ${from.toISOString()}`);
}

/**
 * Returns the previous run time strictly before `from`, as a real instant.
 * Mirrors nextRun exactly, just walking backward through days and picking
 * the last matching hour/minute of each candidate day instead of the first.
 */
export function prevRun(schedule: CronSchedule, from: Date, maxDays = 5 * 366): Date {
  const civilFrom = toCivil(from, schedule.timezone);
  const dayStart = Date.UTC(civilFrom.getUTCFullYear(), civilFrom.getUTCMonth(), civilFrom.getUTCDate());
  const startMinuteOfDay = civilFrom.getUTCHours() * 60 + civilFrom.getUTCMinutes() - 1;

  for (let i = 0; i <= maxDays; i++) {
    const candidate = new Date(dayStart - i * MS_PER_DAY);
    if (!monthMatches(schedule, candidate)) continue;
    if (!dayMatches(schedule, candidate)) continue;

    const maxMinuteOfDay = i === 0 ? startMinuteOfDay : 24 * 60 - 1;
    if (maxMinuteOfDay < 0) continue;
    const found = lastTimeOfDay(schedule.hours, schedule.minutes, maxMinuteOfDay);
    if (found === null) continue;

    const civilResult = new Date(
      Date.UTC(
        candidate.getUTCFullYear(),
        candidate.getUTCMonth(),
        candidate.getUTCDate(),
        found.hour,
        found.minute,
      ),
    );
    return fromCivil(civilResult, schedule.timezone);
  }

  throw new Error(`no run found within ${maxDays} days before ${from.toISOString()}`);
}

/** Formats an instant as an ISO-8601 string in the given timezone, with an
 * explicit UTC offset instead of "Z" (except for UTC itself, which keeps
 * the familiar trailing "Z"). */
export function formatInZone(instant: Date, timeZone: string): string {
  if (timeZone === 'UTC') return instant.toISOString();
  const w = wallClockOf(instant, timeZone);
  const offsetMinutesTotal = Math.round(offsetMsAt(instant, timeZone) / 60000);
  const sign = offsetMinutesTotal < 0 ? '-' : '+';
  const absMinutes = Math.abs(offsetMinutesTotal);
  const offset = `${sign}${pad2(Math.floor(absMinutes / 60))}:${pad2(absMinutes % 60)}`;
  return (
    `${w.year}-${pad2(w.month)}-${pad2(w.day)}T${pad2(w.hour)}:${pad2(w.minute)}:${pad2(w.second)}` +
    offset
  );
}
