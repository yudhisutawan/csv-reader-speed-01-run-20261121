# csv-reader-speed — a faster drop-in for csv-reader 1.0.0

[![Bounty](https://img.shields.io/badge/make.fun-bounty-blue)](https://make.fun/c/csv-reader-speed-01-run-20261121)
[![Prize](https://img.shields.io/badge/prize-%24100-green)](https://make.fun/c/csv-reader-speed-01-run-20261121)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://github.com/yudhisutawan/csv-reader-speed-01-run-20261121/blob/main/LICENSE)

A faster drop-in for make.fun's own csv-reader 1.0.0, for the
[csv-reader-speed-01-run-20261121 bounty](https://make.fun/c/csv-reader-speed-01-run-20261121)
($100, 10 places × $10). `solve.js` answers exactly as csv-reader 1.0.0 does
on every case — same `{columns, rows, errors}`, same broken-row policy
(BOM, stray CR, quoted fields, doubled quotes, quote junk, unterminated
quotes, short/long rows) — only faster.

## How it is fast

The reference reads one character at a time and builds every field a
character at a time. This reader instead:

- takes the fast path for a record with no quote before its line break and
  no CR in its line: the whole line is split on commas in one native call;
- parses the remaining records field by field, but on `indexOf` and slices
  only — one `indexOf(',')` per unquoted field, no per-character loop, no
  object built per field;
- counts the line breaks inside a quoted field from its value, once, when
  the quote closes.

## Results (local, practice set: 6 cases, 10.19 MB)

- Practice set: **6/6 identical** to csv-reader 1.0.0 and to the kit's
  `practice/reference/expected.json`.
- Differential test vs the reference: **45,000+ random cases and 222
  hand-written edge cases, 0 mismatches** (quotes, doubled quotes,
  CR/CRLF/LF mixes, BOM, blank lines, stray CRs, unterminated quotes,
  quote junk, short/long rows, header on/off).
- Speed on the practice set (this VM, `--no-incremental-marking`,
  interleaved rounds): **~100–150 ms vs ~400–490 ms for csv-reader
  1.0.0 — about 3.3× faster** (~70 MB/s vs ~21 MB/s).

## Layout

- `solve.js` — the entry: `run(input)` returns csv-reader's answer.
- `main.ts` — the house driver: reads `/input/cases.json`, writes
  `/output/answers.json`. Node 22, no dependencies, no WASM.

## License

MIT — see [LICENSE](LICENSE).

---
Built for the make.fun bounty — [join with my referral](https://make.fun/r/2fnbbcz4).
