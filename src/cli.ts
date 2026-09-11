#!/usr/bin/env node
import { parseCron, nextRun, prevRun, formatInZone } from './cron.js';
import { explainCron } from './explain.js';

function printUsage(): void {
  console.log(`Usage: cron-next "<cron expression>" [--count N] [--from ISO-8601] [--tz ZONE] [--prev] [--explain]

Prints the next N run times (default 5) for a 5-field cron expression
(minute hour day-of-month month day-of-week). Field matching and printed
times are in UTC unless --tz is given.

  --count N   print N run times instead of the default 5
  --from T    start the search from ISO-8601 timestamp T instead of now
  --tz ZONE   match fields and print times in an IANA timezone (e.g.
              "America/New_York") instead of UTC
  --prev      print the N most recent run times before --from (or now)
              instead of the N upcoming ones
  --explain   print a plain-English description of the schedule and exit,
              without computing any run times

Examples:
  cron-next "*/15 9-17 * * 1-5"
  cron-next "0 0 1 * *" --count 3
  cron-next "30 8 * * 1" --from 2026-01-01T00:00:00Z
  cron-next "0 9 * * 1-5" --tz America/New_York
  cron-next "0 0 1 * *" --prev --count 3
  cron-next "0 0 1 * 1" --explain
`);
}

function main(argv: string[]): number {
  const args = argv.slice(2);
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    printUsage();
    return args.length === 0 ? 1 : 0;
  }

  const expression = args[0] as string;
  let count = 5;
  let from = new Date();
  let explain = false;
  let prev = false;
  let timezone = 'UTC';

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--explain') {
      explain = true;
    } else if (arg === '--prev') {
      prev = true;
    } else if (arg === '--tz') {
      const value = args[++i];
      if (!value) {
        console.error('--tz requires a timezone name, e.g. "America/New_York"');
        return 1;
      }
      timezone = value;
    } else if (arg === '--count') {
      const value = args[++i];
      count = Number(value);
      if (!Number.isInteger(count) || count <= 0) {
        console.error(`--count must be a positive integer, got "${value}"`);
        return 1;
      }
    } else if (arg === '--from') {
      const value = args[++i] ?? '';
      const parsed = new Date(value);
      if (Number.isNaN(parsed.getTime())) {
        console.error(`--from must be a valid ISO-8601 timestamp, got "${value}"`);
        return 1;
      }
      from = parsed;
    } else {
      console.error(`unrecognized argument: "${arg}"`);
      return 1;
    }
  }

  try {
    const schedule = parseCron(expression, timezone);
    if (explain) {
      console.log(explainCron(schedule));
      return 0;
    }
    let cursor = from;
    for (let i = 0; i < count; i++) {
      cursor = prev ? prevRun(schedule, cursor) : nextRun(schedule, cursor);
      console.log(formatInZone(cursor, timezone));
    }
    return 0;
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  }
}

process.exit(main(process.argv));
