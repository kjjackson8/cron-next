# cron-next

A command line tool that tells you when a cron expression will actually run.

Cron syntax looks simple until you hit the edge cases: what happens when
both the day-of-month and day-of-week fields are restricted? Does `7` mean
Sunday or is it invalid? What does `*/25` do in a field that only goes up
to `59`? Most people (and more than a few scheduler implementations) get
these wrong. This tool exists so I can paste an expression in and see the
actual next run times instead of reasoning it out by hand.

## Usage

```
cron-next "<cron expression>" [--count N] [--from ISO-8601] [--tz ZONE] [--prev] [--explain]
```

- `<cron expression>` is a standard 5-field expression: minute, hour,
  day-of-month, month, day-of-week. No seconds field, no year field, no
  `L`/`W`/`#` extensions.
- The month and day-of-week fields accept three-letter names (`JAN`-`DEC`,
  `SUN`-`SAT`) anywhere a number is valid, case-insensitively: single
  values, ranges, and ranges with a step, e.g. `MON-FRI`, `mon,wed,fri`,
  `JAN-JUN/2`.
- `--count N` prints the next N run times instead of the default 5.
- `--from ISO-8601` starts the search from a given timestamp instead of
  now. Useful for reproducing a specific case.
- `--tz ZONE` matches the cron fields against wall-clock time in an IANA
  timezone (e.g. `America/New_York`, `Europe/Berlin`) instead of UTC, and
  prints run times with that zone's offset instead of `Z`. DST transitions
  are handled the way most schedulers handle them: a run time is computed
  from whatever offset is in effect for that wall-clock moment, so `0 9 * *
  *` still means 9am local both before and after the clocks change.
- `--prev` prints the N most recent run times *before* `--from` (or before
  now) instead of the N upcoming ones. Combine with `--from` to look up
  what a schedule's last few runs would have been at a given point in time.
- `--explain` prints a plain-English description of the schedule instead of
  run times, e.g. "Runs at 00:00, on day 1st of the month, or on Monday."
  for `0 0 1 * 1`.
- Without `--tz`, all output is in UTC, printed as ISO-8601 timestamps.

### Examples

Every 15 minutes during business hours on weekdays:

```
$ cron-next "*/15 9-17 * * 1-5"
2026-08-31T09:00:00.000Z
2026-08-31T09:15:00.000Z
2026-08-31T09:30:00.000Z
2026-08-31T09:45:00.000Z
2026-08-31T10:00:00.000Z
```

Midnight on the first of the month, three occurrences:

```
$ cron-next "0 0 1 * *" --count 3
2026-09-01T00:00:00.000Z
2026-10-01T00:00:00.000Z
2026-11-01T00:00:00.000Z
```

Starting the search from a fixed point in time:

```
$ cron-next "30 8 * * 1" --from 2026-01-01T00:00:00Z
2026-01-05T08:30:00.000Z
```

Looking backward instead of forward, from a fixed point in time:

```
$ cron-next "0 0 1 * *" --prev --count 3 --from 2026-09-12T00:00:00Z
2026-09-01T00:00:00.000Z
2026-08-01T00:00:00.000Z
2026-07-01T00:00:00.000Z
```

Matching against local time in a specific zone, across a DST transition
(2026-03-08 is the day US clocks spring forward):

```
$ cron-next "0 9 * * *" --tz America/New_York --count 2 --from 2026-03-07T00:00:00Z
2026-03-07T09:00:00-05:00
2026-03-08T09:00:00-04:00
```

## The awkward cases this handles correctly

- **Day-of-month AND day-of-week both restricted.** Standard cron
  semantics say the day matches if *either* field matches, not both. `0 0
  1 * 1` runs at midnight on the 1st of the month *or* every Monday, not
  only on Mondays that happen to be the 1st.
- **`7` as an alias for Sunday.** Day-of-week accepts `0`-`7`; both `0` and
  `7` mean Sunday.
- **Uneven steps.** `*/25` in the minute field produces `0, 25, 50`, not
  `0, 25, 50, 75` (out of range) and not a rounded-up interval.
- **Feb 29.** `0 0 29 2 *` only fires on leap years, so the gap between
  runs can be several years, not one.
- **Range validation.** `5-1` (inverted), `*/0` (zero step), and
  out-of-bounds values are rejected with a clear error instead of silently
  producing nonsense.
- **Named months and weekdays.** `JAN-DEC` and `SUN-SAT` work anywhere a
  number would, including in ranges and steps, and are matched
  case-insensitively.
- **DST transitions with `--tz`.** A daily schedule keeps firing at the
  same local wall-clock time across a spring-forward or fall-back
  boundary, which means the gap to the previous run in UTC is 23 or 25
  hours instead of 24. Timezone data comes from Node's built-in `Intl`
  support, not a bundled copy of the IANA database.

See `src/cron.test.ts` for the full table of cases, including the invalid
expressions that are expected to be rejected.

## Building

Requires a TypeScript compiler (`tsc`) on your machine; this project has
no dependencies of its own.

```
tsc
node dist/cli.js "*/15 * * * *"
```

## Running the tests

```
tsc
node --test dist/*.test.js
```
