# Progress: Gantt: remove a task from the schedule and drag it back on

## Checklist
*Steps to reach the acceptance criteria. Add, reorder, or expand as work clarifies the plan.*

Wave 0, PRD
- [x] Write `task.md` (PRD)
- [x] Write `progress.md`
- [x] Add index row to `Tasks/index.md`
- [ ] User confirms the PRD (gate before Wave 1)

Wave 1, independent pieces
- [ ] H1: backend `updateDates` `$unset` and history text, jest cases
- [ ] H2: `unscheduleSpan.js` and `ganttUnscheduleSpan.spec.js`
- [ ] H3: `GanttTaskMenu.vue` and `ganttTaskMenu.spec.js`
- [ ] H4: i18n keys, Thai translations, `style.css` classes

Wave 2, integrate `GanttView.vue` (one at a time)
- [ ] H5: menu wiring, `unscheduleTask`, undo toast
- [ ] H6: tray drag and timeline drop

Wave 3, tests
- [ ] H7: integration cases in `ganttTimelineIntegration.spec.js`
- [ ] H8: e2e cases in `gantt-drag-pan.spec.js`

Wave 4, gate
- [ ] H9: run every verification command
- [ ] Opus reviews the full diff and runs browser checks 1 to 6
- [ ] Opus commits on `feat/gantt-unschedule` (git work is Opus only)

## Last step
*One line summary of where work paused. Updated whenever a session ends.*

Wave 0 written. Waiting for the user to confirm the PRD before Wave 1.

## Blockers
*Anything preventing progress. Empty when there are none.*

None.

## Log
*Append-only chronological record. Add an entry whenever a meaningful step completes,
a decision is made, or a blocker is encountered. Newest entries at the bottom.*

### 2026-11-07
- Task created.
