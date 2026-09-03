// Parses standard 5-field cron expressions (minute hour day-of-month month
// day-of-week) and computes upcoming run times. No seconds field, no
// year field, no vixie-cron extensions like L, W or #. All calculations
// happen in UTC so that results are deterministic regardless of the host's
// local timezone or DST rules.

export class CronParseError extends Error {}

export interface CronSchedule {
  minutes: number[];
  hours: number[];
  domSet: Set<number>;
  domRestricted: boolean;
  months: Set<number>;
  dowSet: Set<number>;
  dowRestricted: boolean;
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

export function parseCron(expression: string): CronSchedule {
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

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Returns the next run time strictly after `from`. Searches day by day
 * (fast even for constraints like "Feb 29" that only occur every few years)
 * and then picks the first matching hour/minute within a matching day.
 */
export function nextRun(schedule: CronSchedule, from: Date, maxDays = 5 * 366): Date {
  const dayStart = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  const startMinuteOfDay = from.getUTCHours() * 60 + from.getUTCMinutes() + 1;

  for (let i = 0; i <= maxDays; i++) {
    const candidate = new Date(dayStart + i * MS_PER_DAY);
    if (!monthMatches(schedule, candidate)) continue;
    if (!dayMatches(schedule, candidate)) continue;

    const minMinuteOfDay = i === 0 ? startMinuteOfDay : 0;
    const found = firstTimeOfDay(schedule.hours, schedule.minutes, minMinuteOfDay);
    if (found === null) continue;

    return new Date(
      Date.UTC(
        candidate.getUTCFullYear(),
        candidate.getUTCMonth(),
        candidate.getUTCDate(),
        found.hour,
        found.minute,
      ),
    );
  }

  throw new Error(`no run found within ${maxDays} days of ${from.toISOString()}`);
}
