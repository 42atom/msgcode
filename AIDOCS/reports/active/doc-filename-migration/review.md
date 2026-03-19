# Doc Filename Migration Review

## Summary

- issues rename map: 229
- plan docs rename map: 0
- research docs rename map: 0
- linked plan docs reused issue id: 0
- linked research docs reused issue id: 0
- board review needed: 0
- active task priority review needed: 0
- delete candidates under vendor/build archive: 0

## Confirmed Decisions

- merge `docs/design/` and `docs/notes/` into `docs/plan/`
- allow deletion of `docs/archive/retired-desktop-bridge/mac/msgcode-desktopctl/.build/checkouts/**`
- completed tasks do not get `prio`; only active tasks may receive `p0/p1/p2`
- unlinked historical plan/research docs use `9000+` id range

## Manual Review

### Active Tasks Missing Priority

- none

### Board Needs Review

- none

## Output Files

- `AIDOCS/reports/active/doc-filename-migration/rename-map.tsv`
- `AIDOCS/reports/active/doc-filename-migration/delete-candidates.txt`
- `AIDOCS/reports/active/doc-filename-migration/review.md`
