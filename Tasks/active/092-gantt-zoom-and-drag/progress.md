# Progress: Gantt Ctrl+wheel zoom, whole-day drag snapping and date validation

## Checklist

- [x] Wave 0: PRD and branch
- [x] Wave 1: independent pieces (backend validation, zoom model, snap helper, i18n and style)
- [x] Wave 2: integrate GanttView.vue (zoom wiring, snapping, tooltip)
- [x] Wave 3: tests
- [ ] Wave 4: gate passed. The manual browser checks 1-9 have not been done yet.

## Last step

The automated gate passed on `feat/gantt-zoom-drag`. Manual browser checks and a PR are next.

## Blockers

None.

## Log

### 2026-11-06
- Task created. The PRD was confirmed (`d06ef1951`).
- Wave 1:
  - `updateDates` rejects a start after the due date and rejects invalid dates. The date check is part of the `findOneAndUpdate` filter, so check and write happen together.
  - Added `zoomModel.js` and `snapDragDates`.
  - Added the `drag_range` and `zoom_hint` keys. Thai has a real translation; `drag_range` is on the Thai allowlist because it holds only placeholders and an arrow.
  - Added the `.gv__dragtip` style.
- Wave 2:
  - `GanttView.vue`: Ctrl+wheel zoom anchored at the cursor (rAF coalescing and a 33ms throttle), zoom saved per project, whole-day snapping on the live copy and again on `onBeforeTaskChanged`, and the live date tooltip.
  - Removed the `drag_snapped_back` toast and its key.
  - Pinned `dhtmlx-gantt` to 8.0.11.
  - Review fixes:
    - The backup snap now acts on `gantt.getTask(id)`. dhtmlx passes a copy of the bar from before the drag.
    - A pending zoom save is flushed instead of dropped when a drag starts or the view unmounts.
- Wave 3:
  - Mocks completed.
  - 11 integration cases added, covering R1, R3, R6, R7, R8, R14 and R15.
  - The e2e spec clears the saved zoom before each test and adds a Ctrl+wheel case.
  - Breaking the code on purpose (the anchor sign, the throttle, the backup snap) makes the matching tests fail.
- Wave 4 gate:
  - Backend jest: 6 suites, 1885 tests pass.
  - `i18n:check` and `style:check` pass.
  - e2e `gantt-drag-pan`: 3/3 pass (`npm run e2e:db`). The first attempt crashed Chromium while another heavy job was running alongside it; the retry on its own passed.
  - Frontend `npm test`: the only failures are the same 47 tests in 13 files that fail on the tree before this work.
  - Lint passes.
  - Build passes with `NODE_OPTIONS=--max-old-space-size=8192`.
  - On this Windows machine, run the gate steps one at a time.
