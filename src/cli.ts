#!/usr/bin/env node
import { parseCron, nextRun } from './cron.js';

function printUsage(): void {
  console.log(`Usage: cron-next "<cron expression>" [--count N] [--from ISO-8601]

Prints the next N run times (default 5) for a 5-field cron expression
(minute hour day-of-month month day-of-week). All times are UTC.

Examples:
  cron-next "*/15 9-17 * * 1-5"
  cron-next "0 0 1 * *" --count 3
  cron-next "30 8 * * 1" --from 2026-01-01T00:00:00Z
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

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--count') {
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
    const schedule = parseCron(expression);
    let cursor = from;
    for (let i = 0; i < count; i++) {
      cursor = nextRun(schedule, cursor);
      console.log(cursor.toISOString());
    }
    return 0;
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  }
}

process.exit(main(process.argv));
