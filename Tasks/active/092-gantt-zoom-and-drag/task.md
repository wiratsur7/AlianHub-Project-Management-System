---
id: 092
title: Gantt Ctrl+wheel zoom, whole-day drag snapping and date validation
status: active
priority: medium
depends_on: []
created: 2026-11-06
---

# 092 - Gantt Ctrl+wheel zoom, whole-day drag snapping and date validation

## Goal

Let people zoom the Gantt board with Ctrl+wheel (anchored at the cursor, switching Day/Week/Month automatically), remember the zoom per browser and per project, show the dragged dates while a bar moves, land every drag on whole days, and reject start-after-due on single-task date updates. Today Ctrl+wheel changes the browser page zoom, small drags snap back to the week grid with a toast, and the server accepts invalid date ranges on single-task updates.

## Scope

- **A. Zoom.** Ctrl/Meta+wheel smooth zoom anchored at the cursor, with automatic Day/Week/Month band switching. Trackpad pinch works through ctrl+wheel.
- **B. Zoom memory.** Zoom is saved per browser and per project in localStorage under `gantt.zoom.v1.<projectId>`.
- **C. Drag tooltip.** A live date range tooltip shows while a bar is dragged.
- **D. Whole-day drags.** Drags and resizes land on whole days at every zoom level. The `drag_snapped_back` toast is removed.
- **E. Backend validation.** Single-task `updateDates` rejects start after due and invalid dates, atomically. Equal dates are allowed.

Files in scope:
- `frontend/src/views/Projects/GanttView/GanttView.vue`
- `frontend/src/views/Projects/GanttView/zoomModel.js` (new)
- `frontend/src/views/Projects/GanttView/dragSnap.js`
- `frontend/src/views/Projects/GanttView/style.css`
- `frontend/src/locales/en.js` (new keys, plus the backfill output)
- `frontend/package.json` (pin `dhtmlx-gantt` to `8.0.11`)
- `Modules/Tasks/helpers/taskMongo/updateBasic.js` (`updateDates`)
- Tests: `frontend/tests/unit/ganttZoomModel.spec.js` (new), `frontend/tests/unit/ganttDragSnap.spec.js`, `frontend/tests/unit/ganttTimelineIntegration.spec.js`, `frontend/tests/unit/ganttWorkingCalendar.spec.js`, `frontend/tests/unit/ganttShiftWorkingDays.spec.js`, `tests/tasks-update-dates.test.js` (new), `e2e/specs/gantt-drag-pan.spec.js`

## Out of scope

- Safari `gesture*` pinch events (R4). On Safari, Ctrl+wheel with a mouse and the Day/Week/Month tabs still work.
- Server-side storage of zoom preferences.
- `gantt.ext.zoom`. The zoom uses a custom wheel handler.
- Continuous custom drag handles.
- `TimelineView.vue`.
- The 10 uncommitted `frontend/src/locales/*.pending.json` files. They belong to the user and are not touched by this task, except for the keys this task adds through `i18n:backfill`.

## Acceptance criteria

Zoom (A, B)
- [ ] Ctrl+wheel and Meta+wheel over the Gantt call `preventDefault`, so the browser page does not zoom.
- [ ] The date under the cursor stays under the cursor during a Ctrl+wheel zoom (checked by hand on a large project).
- [ ] Crossing a band boundary does not flicker, and the Day/Week/Month tab highlight follows the band.
- [ ] Ten wheel events in one frame cause exactly one `gantt.render()` call.
- [ ] Renders are at most one per frame and at least 33 ms apart. Smart rendering and smart scales stay on.
- [ ] No frame over 50 ms while zooming on the largest demo project (Performance panel recording).
- [ ] After a zoom, `pxPerDay` matches the scale dhtmlx actually renders.
- [ ] Ctrl+wheel during a task drag, a pan, or while the shift-preview dialog is open does nothing (`min_column_width` unchanged).
- [ ] After unmount, a wheel event calls nothing and the pending animation frame is cancelled.
- [ ] Zoom is saved per project and restored on reload.
- [ ] With localStorage throwing, or holding garbage, NaN or an out-of-range value, the view opens at Week and nothing crashes.
- [ ] Zooming out on a small project grows the visible range.
- [ ] A trackpad pinch zooms (checked by hand).

Drag and snapping (D)
- [ ] In Week and Month views, drags and resizes land on whole days, with no toast.
- [ ] A move of 0.4 days gives 0 days, and 0.6 days gives 1 day.
- [ ] Resizing either edge keeps the other edge's time of day.
- [ ] The `copy` object is snapped during the drag, and `onBeforeTaskChanged` also gives whole-day dates.
- [ ] A drag of less than half a day reverts quietly.
- [ ] No references to `drag_snapped_back` or `snappedBack` remain in `frontend/src`, `frontend/tests` or `e2e`.

Tooltip (C)
- [ ] The tooltip shows while dragging, follows the pointer, and disappears on drop, on window blur, on a rejected drag, and on unmount.
- [ ] The tooltip text equals the shift dialog's range text for the same drag.

Backend (E)
- [ ] `updateDates` with start after due returns `{status:false, statusText:"Start date must be on or before the due date"}`, and does not write, emit or add a history entry.
- [ ] `updateDates` with an invalid date string returns `{status:false, statusText:"Invalid date"}`.
- [ ] Sending only one date is checked against the stored counterpart, inside the `findOneAndUpdate` filter.
- [ ] A null or empty date still clears the field.
- [ ] A missing task returns "Task not found", not the date-order error.
- [ ] Equal start and due dates are accepted.

Checks
- [ ] `cd frontend && npm test` passes.
- [ ] `npm run lint -- --no-fix` passes.
- [ ] `npm run build` passes.
- [ ] `npm run i18n:check` passes.
- [ ] `npm run style:check` passes.
- [ ] `npx jest tests/tasks-update-dates.test.js tests/permission-task-write-keys.test.js tests/task-write-company-fields.test.js` passes.
- [ ] `tests/mcp-task-dates-move-waiting.test.js` and `tests/task-write-places.test.js` pass.
- [ ] `e2e/specs/gantt-drag-pan.spec.js` passes with the repo's e2e runner.
- [ ] Manual checks 1 to 9 in the plan's Verification section are done and recorded in `progress.md`.

## Constraints & notes

- Branch `feat/gantt-zoom-drag`, cut from `feat/my-work`. It builds on the Gantt drag, pan guard and growing range from commit `fb6cf285f`.
- The 10 `frontend/src/locales/*.pending.json` files have uncommitted changes that are not ours. Do not stash, reset or commit them. Stage only this task's keys.
- CLAUDE.md rules apply:
  - Rule 1: comments only where the code cannot carry the intent.
  - Rule 3: every user-visible string goes through `en.js`, then `npm run i18n:backfill`.
  - Rule 4: Conventional Commit titles.
  - Rule 5: colours come from tokens in `tokens.css`.
- dhtmlx-gantt is pinned to exactly `8.0.11`.
- Dates use `shortDate` and `formatDisplayDate` (`@/views/Settings/Language/localePrefs`). Do not format dates by hand.
- Use a custom wheel handler, not `gantt.ext.zoom`. The ext writes `config.start_date` and `end_date`, which conflicts with `timelineRange.js`.
- Zoom must not run during a drag or pan. dhtmlx caches pixel positions when a drag starts.
- Single-task `updateDates` lives at `Modules/Tasks/helpers/taskMongo/updateBasic.js`. Bulk update already rejects these ranges, so the single-task rule matches it. Agents and MCP call `updateDates` through `Modules/Agents/guard.js`, so the new rejection must use the same response shape as the other errors.
- Team model: Opus owns the plan, the review and all git work. A Sonnet lead runs each wave. Haiku workers do the routine coding and test runs. Workers do not touch git.

## Risks

| # | Risk | Handling | What we do |
|---|---|---|---|
| R1 | `gantt.render()` on every zoom frame is slow on large projects | Guardrail | One rAF per frame, at least 33 ms between zoom renders. Smart rendering and smart scales stay on. |
| R2 | Month cells are equal width, so px per day is approximate | Fix | After each render, `pxPerDay` is read back from the real scale. |
| R3 | Mutating `copy` in `onTaskDrag` relies on dhtmlx internals | Guardrail | Pin `dhtmlx-gantt` to `8.0.11`. Re-snap in `onBeforeTaskChanged` as a second safety net. |
| R4 | Safari trackpad pinch fires `gesture*` events, not ctrl+wheel | Accept | Out of scope. Ctrl+wheel with a mouse and the tabs still work. |
| R5 | `time_step=1` affects other code | Resolved in planning | A grep of `frontend/src` found nothing else that reads `time_step` or `round_dnd_dates`. Re-checked before setting it. |
| R6 | Ctrl+wheel during a drag or pan breaks cached pixel positions | Guardrail | The wheel handler returns early while a drag, a pan or the shift preview is active. Pending zoom frames are cancelled when a drag starts. |
| R7 | A wheel event races with a pending viewport restore | Fix | Zoom restores the viewport synchronously. The existing version bump still cancels old restores. |
| R8 | Bad or blocked localStorage value | Guardrail | Versioned key. Values are checked with `Number.isFinite`, clamped, and read inside try/catch. Falls back to Week. |
| R9 | The e2e drag test assumes a week column and a saved zoom would change it | Guardrail | The e2e test clears `gantt.zoom.v1.*` in `beforeEach`, or selects the Week tab. |
| R10 | Check-then-write validation leaves a race window | Fix | The start/due rule sits in the `findOneAndUpdate` filter itself. A null result triggers one `findOne` to tell "not found" from "start after due". |
| R11 | Agents and MCP call `updateDates` and see the new rejection | Guardrail | Only invalid data is rejected, in the same `{status:false, statusText}` shape. Related tests are re-run. |
| R12 | `i18n:backfill` writes to `*.pending.json` files that hold the user's uncommitted changes | Guardrail | Workers never stash, reset or commit. Only this task's keys are staged, with `git add -p`. Mixed hunks go to the user first. |
| R13 | A stray `drag_snapped_back` or `snappedBack` reference remains | Guardrail | Grep `frontend/src`, `frontend/tests` and `e2e` before deleting. Caught by `i18n:check`, `npm test` and `npm run build`. |
| R14 | Zoom listeners or timers leak on unmount, or survive on the shared gantt object | Guardrail | One cleanup path: cancel the frame, clear the persist timer, clear the tooltip. `round_dnd_dates` and `time_step` are set again on each mount. |
| R15 | The tooltip date convention differs from the grid (due is exclusive) | Fix | The tooltip uses the same dates and `shortDate` as the shift dialog. |

## Waves and commits

Opus cuts the branch and writes each wave brief. A Sonnet lead runs each wave and spawns Haiku workers. Opus checks each wave against the diff and test output, then commits. Workers never touch git.

- **Wave 0, PRD and branch.** Cut the branch. Draft this PRD and `progress.md`. Gate: the user confirms the PRD before Wave 1.
- **Wave 1, independent pieces.** Backend validation (H1), zoom model (H2), snap helper (H3), i18n and style (H4). Commits: `fix(tasks)`, `feat(gantt): zoom model`, `feat(gantt): whole-day snap helper`, `chore(i18n)`.
- **Wave 2, integrate `GanttView.vue`.** Zoom wiring (H5), snapping and the toast removal with the `dhtmlx-gantt` pin (H6), tooltip (H7). Strictly in order, one file. Done when `npm test` and `npm run build` pass.
- **Wave 3, tests.** Mock updates (H8), integration cases (H9), e2e update (H10). Commit: `test(gantt)`.
- **Wave 4, gate.** Run every verification command (H11), sort any failures to their owner, Opus reviews the full branch diff and runs the manual browser checks, then the final commit.

Commits, in order:
1. `docs(tasks)`: the 092 PRD and progress file.
2. `fix(tasks)`: reject start after due in single-task `updateDates`.
3. `feat(gantt)`: zoom model.
4. `feat(gantt)`: whole-day snap helper.
5. `chore(i18n)`: drag range and zoom hint keys.
6. `feat(gantt)`: Ctrl+wheel zoom anchored at the cursor, saved per project.
7. `feat(gantt)`: drags land on whole days at every zoom.
8. `feat(gantt)`: live date tooltip while dragging.
9. `test(gantt)`: zoom, snap and tooltip coverage.

## Resources

None yet. The approved plan lives outside the repo at `C:\Users\BRS12\.claude\plans\squishy-coalescing-nest.md`.
