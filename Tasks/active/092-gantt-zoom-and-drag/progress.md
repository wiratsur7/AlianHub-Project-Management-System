# Progress: Gantt Ctrl+wheel zoom, whole-day drag snapping and date validation

## Checklist

- [x] Wave 0: PRD and branch
- [x] Wave 1: independent pieces (backend validation, zoom model, snap helper, i18n and style)
- [x] Wave 2: integrate GanttView.vue (zoom wiring, snapping, tooltip)
- [x] Wave 3: tests
- [x] Wave 4: the gate passed and the manual browser checks are done. Two checks remain open; see the log.

## Last step

Manual browser checks are done on `feat/gantt-zoom-drag`. A PR is next.

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
- Manual browser checks:
  - Setup: e2e harness server with a seeded project of 6 dated tasks. Headless Chromium at 1600×1000, using trusted Ctrl+wheel events.
  - The in-app browser pane was hidden, which slowed requestAnimationFrame to about 1/s. That made zoom ticks merge, so the timing measurements were redone in headless Chromium.

  | # | Check | Result |
  |---|---|---|
  | 1 | Date under the cursor while zooming | Holds. 12 fast ticks in: Dec 21 07:12 → 08:49, about 5px. 30 fast ticks out into Month: about 3 days, about 3px. `devicePixelRatio` stays 1 and the page width is unchanged, so the page does not zoom. |
  | 2 | Band switching | Week → Day → Month in both directions. The tab highlight follows. The Day band shows `13 DEC` columns at 68px. |
  | 3 | Trackpad pinch | Not tested by hand; the unit tests cover small-delta pinch. |
  | 4 | Zoom saved on reload | Holds. `gantt.zoom.v1.<projectId>` is written and the zoom is restored after reload. Clicking a tab keeps the left-edge date (same day). |
  | 5 | Zooming out grows the range | Yes. The range grew to 2021-09 → 2031-01 while the date under the cursor stayed the same. |
  | 6 | Week-view drag of 0.35 column | Moved by whole days. Nov 26–Dec 10 → Nov 28–Dec 12, saved, and still there after a reload. The tooltip reads `Nov 28 → Dec 12` during the drag and is gone after the drop. No toast. |
  | 7 | Ctrl+wheel during a drag | Ignored. Column width stayed at 70. |
  | 8 | Shift dialog | Not checked here: the seed has no dependencies. Covered by `ganttShiftWorkingDays.spec.js`. |
  | 9 | Day-off shading | 56 shaded day-off cells in the Day band. |
