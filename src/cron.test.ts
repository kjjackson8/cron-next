import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCron, nextRun, formatInZone, CronParseError } from './cron.js';

interface NextRunCase {
  name: string;
  expression: string;
  from: string;
  expected: string;
}

// Each case below hits a specific piece of cron semantics that is easy to
// get wrong in a naive implementation.
const NEXT_RUN_CASES: NextRunCase[] = [
  {
    name: 'step values land on the next multiple, not the next minute',
    expression: '*/15 * * * *',
    from: '2026-01-01T00:05:00Z',
    expected: '2026-01-01T00:15:00Z',
  },
  {
    name: 'step that does not evenly divide the range stops before the max',
    expression: '*/25 * * * *',
    from: '2026-01-01T00:10:00Z',
    expected: '2026-01-01T00:25:00Z',
  },
  {
    name: 'business hours skip the weekend and roll to Monday',
    expression: '0 9-17 * * 1-5',
    from: '2026-08-28T20:00:00Z', // Friday, after the last matching hour
    expected: '2026-08-31T09:00:00Z', // Monday
  },
  {
    name: 'day-of-week 0 means Sunday',
    expression: '30 8 * * 0',
    from: '2026-08-28T00:00:00Z', // Friday
    expected: '2026-08-30T08:30:00Z', // Sunday
  },
  {
    name: 'day-of-week 7 is an alias for Sunday, same result as 0',
    expression: '30 8 * * 7',
    from: '2026-08-28T00:00:00Z',
    expected: '2026-08-30T08:30:00Z',
  },
  {
    name: 'day-of-month and day-of-week both restricted match on EITHER, not AND',
    expression: '0 0 1 * 1',
    from: '2026-08-28T00:00:00Z', // Friday; next Monday (31st) beats next 1st (Sep 1)
    expected: '2026-08-31T00:00:00Z',
  },
  {
    name: 'only day-of-month restricted ignores day-of-week entirely',
    expression: '0 6 15 * *',
    from: '2026-08-28T00:00:00Z',
    expected: '2026-09-15T06:00:00Z',
  },
  {
    name: 'Feb 29 only fires on leap years, so it can skip several years',
    expression: '0 0 29 2 *',
    from: '2026-08-28T00:00:00Z',
    expected: '2028-02-29T00:00:00Z',
  },
  {
    name: 'combined list and range fields',
    expression: '0 6,18 1-5 * *',
    from: '2026-01-01T00:00:00Z',
    expected: '2026-01-01T06:00:00Z',
  },
  {
    name: 'named month range is equivalent to its numeric range',
    expression: '0 0 1 JAN-MAR *',
    from: '2026-08-28T00:00:00Z',
    expected: '2027-01-01T00:00:00Z',
  },
  {
    name: 'named day-of-week list, case-insensitive',
    expression: '0 9 * * mon,Wed,FRI',
    from: '2026-08-28T00:00:00Z', // Friday, before 9am
    expected: '2026-08-28T09:00:00Z',
  },
  {
    name: 'named day-of-week range with a step',
    expression: '0 0 * * MON-FRI/2',
    from: '2026-08-28T00:00:00Z', // Friday; MON-FRI/2 -> Mon, Wed, Fri
    expected: '2026-08-31T00:00:00Z', // next Monday
  },
];

for (const testCase of NEXT_RUN_CASES) {
  test(`nextRun: ${testCase.name}`, () => {
    const schedule = parseCron(testCase.expression);
    const result = nextRun(schedule, new Date(testCase.from));
    assert.equal(result.toISOString(), testCase.expected);
  });
}

interface InvalidCase {
  name: string;
  expression: string;
}

const INVALID_CASES: InvalidCase[] = [
  { name: 'too few fields', expression: '* * * *' },
  { name: 'too many fields', expression: '* * * * * *' },
  { name: 'minute out of range', expression: '60 * * * *' },
  { name: 'hour out of range', expression: '* 24 * * *' },
  { name: 'day-of-month zero is out of range', expression: '* * 0 * *' },
  { name: 'month out of range', expression: '* * * 13 *' },
  { name: 'day-of-week out of range', expression: '* * * * 8' },
  { name: 'zero step is meaningless', expression: '*/0 * * * *' },
  { name: 'inverted range', expression: '5-1 * * * *' },
  { name: 'non-numeric segment', expression: 'abc * * * *' },
  { name: 'unknown month name', expression: '0 0 1 FOO *' },
  { name: 'unknown day-of-week name', expression: '0 0 * * XYZ' },
  { name: 'day names are not valid in the day-of-month field', expression: '0 0 MON * *' },
];

for (const testCase of INVALID_CASES) {
  test(`parseCron rejects: ${testCase.name}`, () => {
    assert.throws(() => parseCron(testCase.expression), CronParseError);
  });
}

test('nextRun advances strictly after "from", even on an exact match', () => {
  const schedule = parseCron('0 * * * *');
  const result = nextRun(schedule, new Date('2026-01-01T05:00:00Z'));
  assert.equal(result.toISOString(), '2026-01-01T06:00:00Z');
});

test('nextRun rejects an unknown timezone name', () => {
  assert.throws(() => parseCron('* * * * *', 'Not/AZone'), CronParseError);
});

test('nextRun matches fields against wall-clock time in the given timezone', () => {
  // 09:00 in New York on Jan 1 2026 (standard time, UTC-5) is 14:00 UTC.
  const schedule = parseCron('0 9 * * *', 'America/New_York');
  const result = nextRun(schedule, new Date('2026-01-01T00:00:00Z'));
  assert.equal(result.toISOString(), '2026-01-01T14:00:00.000Z');
});

test('nextRun follows the DST offset change across a spring-forward transition', () => {
  // US DST starts 2026-03-08 at 02:00 local (EST, UTC-5, springs forward to
  // EDT, UTC-4). 09:00 local on Mar 7 is still EST; 09:00 local on Mar 8,
  // after the 02:00 jump, is already EDT.
  const schedule = parseCron('0 9 * * *', 'America/New_York');
  const first = nextRun(schedule, new Date('2026-03-07T00:00:00Z'));
  assert.equal(first.toISOString(), '2026-03-07T14:00:00.000Z');
  const second = nextRun(schedule, first);
  assert.equal(second.toISOString(), '2026-03-08T13:00:00.000Z');
});

test('formatInZone renders UTC with the familiar "Z" suffix', () => {
  assert.equal(formatInZone(new Date('2026-01-01T14:00:00Z'), 'UTC'), '2026-01-01T14:00:00.000Z');
});

test('formatInZone renders a non-UTC zone with an explicit offset', () => {
  assert.equal(
    formatInZone(new Date('2026-01-01T14:00:00Z'), 'America/New_York'),
    '2026-01-01T09:00:00-05:00',
  );
});
