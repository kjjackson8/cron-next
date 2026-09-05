import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCron } from './cron.js';
import { explainCron } from './explain.js';

interface ExplainCase {
  name: string;
  expression: string;
  expected: string;
}

const CASES: ExplainCase[] = [
  {
    name: 'every minute, no restrictions',
    expression: '* * * * *',
    expected: 'Runs every minute, every day.',
  },
  {
    name: 'a single fixed time every day',
    expression: '30 8 * * *',
    expected: 'Runs at 08:30, every day.',
  },
  {
    name: 'even step in the minute field reads as "every N minutes"',
    expression: '*/15 * * * *',
    expected: 'Runs at every 15 minutes from 0 through 45 past every hour, every day.',
  },
  {
    name: 'an uneven step still describes the actual run values',
    expression: '*/25 * * * *',
    expected: 'Runs at every 25 minutes from 0 through 50 past every hour, every day.',
  },
  {
    name: 'a small cross product of hours and minutes is spelled out as clock times',
    expression: '0 6,18 * * *',
    expected: 'Runs at 06:00 and 18:00, every day.',
  },
  {
    name: 'a contiguous hour range reads as "through", not a list',
    expression: '0 9-17 * * *',
    expected: 'Runs at minute 0 during hours 9 through 17, every day.',
  },
  {
    name: 'day-of-month only, with an ordinal and a contiguous range',
    expression: '0 6 1-5 * *',
    expected: 'Runs at 06:00, on days 1st through 5th of the month.',
  },
  {
    name: 'day-of-week only, named and contiguous',
    expression: '0 9 * * 1-5',
    expected: 'Runs at 09:00, on Monday through Friday.',
  },
  {
    name: 'day-of-week 0 and 7 both collapse to a single Sunday',
    expression: '0 0 * * 0',
    expected: 'Runs at 00:00, on Sunday.',
  },
  {
    name: 'day-of-month and day-of-week both restricted combine with "or"',
    expression: '0 0 1 * 1',
    expected: 'Runs at 00:00, on day 1st of the month, or on Monday.',
  },
  {
    name: 'a single restricted month is named and appended',
    expression: '0 0 29 2 *',
    expected: 'Runs at 00:00, on day 29th of the month, in February.',
  },
  {
    name: 'a stepped named weekday range',
    expression: '0 0 * * MON-FRI/2',
    expected: 'Runs at 00:00, on every 2 from Monday through Friday.',
  },
  {
    name: 'a named month range',
    expression: '0 0 1 JAN-MAR *',
    expected: 'Runs at 00:00, on day 1st of the month, in January through March.',
  },
];

for (const testCase of CASES) {
  test(`explainCron: ${testCase.name}`, () => {
    const schedule = parseCron(testCase.expression);
    assert.equal(explainCron(schedule), testCase.expected);
  });
}
