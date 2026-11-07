# Progress: Gantt: remove a task from the schedule and drag it back on

## Checklist

- [x] Wave 0: PRD and branch (user confirmed the PRD)
- [x] Wave 1: backend, span helper, menu component, i18n and style
- [x] Wave 2: GanttView.vue wiring (menu, unschedule, undo, tray drop)
- [x] Wave 3: integration and e2e tests
- [x] Wave 4: gate

## Last step

Gate passed on `feat/gantt-unschedule`. Not pushed. Browser check 6 (List view grouping after a clear) is not done by hand.

## Blockers

None.

## Log

### 2026-11-07
- Task created.
- Wave 1:
  - `updateDates` unsets `groupByDueDateIndex` when DueDate is cleared, and logs "removed the task from the Gantt schedule." when both dates are cleared.
  - Added `unscheduleSpan.js`, `GanttTaskMenu.vue`, five `Views` keys with Thai translations, and the menu, drop-line and dragging styles.
- Wave 2:
  - Right-click menu on task bars and rows. Remove from schedule with a guarded undo toast.
  - Tray items drag onto the timeline and land on the drop day with the remembered length.
  - Review fixes: duplicate timeline listeners were removed, and the disabled item uses `--ink-2`.
- Wave 3:
  - 13 integration cases.
  - 2 e2e cases: remove then undo, and tray drop. Playwright's native `dragTo` fires the drop.
  - The e2e server serves `frontend/dist`, so rebuild the frontend before running e2e.
- Wave 4 gate:
  - Backend Jest: 4 suites, 1065 tests pass.
  - Frontend `npm test`: 47 failures in 13 files, the same as the base. This includes the two `ganttCalendarTokens` failures (calendar 40px, planner 44px), which also fail on the base.
  - Lint, `i18n:check` and `style:check` pass.
  - Build passes.
  - e2e `gantt-drag-pan`: 5/5 pass.
