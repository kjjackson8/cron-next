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
cron-next "<cron expression>" [--count N] [--from ISO-8601]
```

- `<cron expression>` is a standard 5-field expression: minute, hour,
  day-of-month, month, day-of-week. No seconds field, no year field, no
  `L`/`W`/`#` extensions.
- `--count N` prints the next N run times instead of the default 5.
- `--from ISO-8601` starts the search from a given timestamp instead of
  now. Useful for reproducing a specific case.
- All output is in UTC, printed as ISO-8601 timestamps.

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
