import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCron, nextRun, CronParseError } from './cron.js';

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
