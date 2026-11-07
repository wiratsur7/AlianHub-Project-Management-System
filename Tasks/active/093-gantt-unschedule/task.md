---
id: 093
title: "Gantt: remove a task from the schedule and drag it back on"
status: active
priority: medium
depends_on: []
created: 2026-11-07
---

# 093 - Gantt: remove a task from the schedule and drag it back on

## Goal

Let people take one task off the Gantt timeline without deleting it. A right-click menu on a bar or a task row clears the task's start and due dates, with an Undo toast. The task then waits in the Unscheduled tray and can be placed again by dragging it from the tray onto the timeline, keeping its previous length.

## Scope

- **Backend.** `updateDates` (`Modules/Tasks/helpers/taskMongo/updateBasic.js`):
  - When DueDate is sent as null, add `$unset: { groupByDueDateIndex: "" }`, the same as `updateDueDate`.
  - When both sent dates are null, the history entry reads "removed the task from the Gantt schedule." Otherwise it keeps "rescheduled the task on the Gantt."
  - No new route and no permission change.
- **Right-click menu.** New `frontend/src/views/Projects/GanttView/GanttTaskMenu.vue`, wired in `GanttView.vue`:
  - Opens on a real task bar or a grid task row. Sprint bands, milestones and empty space keep the browser menu.
  - Items: Open task, and Remove from schedule (disabled with a reason when it cannot run).
- **Unschedule and undo.** `unscheduleTask(task)` saves both dates as null through `saveDates`, then shows an Undo toast. Undo writes the previous dates back only if the task still has both dates null. Otherwise it shows the existing shift-failed error.
- **Remembered span.** New `frontend/src/views/Projects/GanttView/unscheduleSpan.js` exports `spanKey`, `rememberSpan` and `takeSpan`. The key is `gantt.span.v1.<projectId>.<taskId>` in localStorage. Reads and writes are try/catch-safe and use `Number.isFinite`. A missing or invalid span falls back to 1 day.
- **Drag from tray to timeline.**
  - Tray rows are `draggable` when `canEditTaskDates(t) && !readOnly`. The drag carries the task id under `application/x-alianhub-task`, and `.gv__tray-item--dragging` marks the dragged row.
  - The timeline shows a drop line (`.gv__droptarget-line`) and a drag tip with the landing range.
  - On drop, start is the drop day at local midnight. End is start plus the remembered span in whole calendar days, with a minimum of 1 day. The span is then cleared.
- **i18n.** New keys in `frontend/src/locales/en.js` under `Views`: `unschedule`, `unscheduled_done`, `open_task`, `unschedule_locked`, `tray_drag_hint`. Run `npm run i18n:backfill`, add Thai translations, and run `npm run i18n:check`.
- **Styles.** `.gv__menu`, `.gv__menu-item`, `.gv__droptarget-line` and `.gv__tray-item--dragging` in `frontend/src/views/Projects/GanttView/style.css`, using tokens only.
- **Tests.**
  - Backend: `tests/tasks-update-dates.test.js`.
  - Unit: new `frontend/tests/unit/ganttUnscheduleSpan.spec.js` and `frontend/tests/unit/ganttTaskMenu.spec.js`.
  - Integration: extend `frontend/tests/unit/ganttTimelineIntegration.spec.js`.
  - e2e: extend `e2e/specs/gantt-drag-pan.spec.js`.

## Out of scope

- The remembered span is not shared across browsers. Another browser places a task with 1 day.
- No shift dialog on placement. Dropping a task from the tray does not run the shift plan, the same as the existing Schedule button.
- Touch drag. HTML5 drag does not work on touch, so the tray's Schedule button stays as the touch and keyboard path.

## Acceptance criteria

Backend
- [ ] `updateDates` with DueDate null includes `$unset: { groupByDueDateIndex: "" }` in the update. A set does not unset.
- [ ] Clearing both dates writes the history text "removed the task from the Gantt schedule." Clearing only one date or setting dates keeps "rescheduled the task on the Gantt."
- [ ] `npx jest tests/tasks-update-dates.test.js` passes with the new cases, and `tests/permission-task-write-keys.test.js`, `tests/task-write-company-fields.test.js` and `tests/mcp-task-dates-move-waiting.test.js` still pass.

Right-click menu
- [ ] Right-clicking a real task bar or task row opens the menu with Open task and Remove from schedule.
- [ ] Right-clicking a sprint band, a milestone or empty space opens no menu of ours and keeps the browser menu (U2).
- [ ] Remove from schedule is disabled with a reason in read-only mode, on archived tasks, without permission, and while a guard is busy (U3).
- [ ] The menu's first item takes focus on open. Arrow keys move between items. Esc and an outside pointerdown close it.
- [ ] The menu closes on scroll, zoom, drag start, window blur, re-render and unmount (U3).

Remove and undo
- [ ] Browser check 1: right-click a bar, choose Remove from schedule. The bar disappears and appears in the Unscheduled tray.
- [ ] Browser check 2: Undo brings back the exact previous start and due dates (U1).
- [ ] Undo is skipped and shows the shift-failed error if the task was re-dated after the removal (U1).
- [ ] Removing a task keeps its links and relations, so arrows return when it is placed again.

Re-schedule by drag
- [ ] Browser check 3: drag the tray item onto a day. The task starts that day with its old length.
- [ ] Browser check 4: a task that never had dates lands as 1 day.
- [ ] The drop start is local midnight of the drop day. A drop across a DST change lands on the intended day (U6).
- [ ] A drop outside the timeline content, or while a guard is busy, does nothing.
- [ ] Tray rows are not draggable when `readOnly` or when `canEditTaskDates(t)` is false.
- [ ] The span round trip works (remember, then take). Storage that throws, holds garbage or holds a non-finite value falls back to 1 day (`ganttUnscheduleSpan.spec.js`).

Read-only and List
- [ ] Browser check 5: in read-only mode no Remove action is shown.
- [ ] Browser check 6: the List view still loads and groups by due date after a clear (U4).

Risks and touch
- [ ] Tray drag is mouse only. The tray's Schedule button still places a task on touch and keyboard (U7).

Checks
- [ ] `cd frontend && npm test` shows no new failures beyond the 47 known pre-existing ones.
- [ ] `cd frontend && npm run lint -- --no-fix` passes.
- [ ] `cd frontend && npm run build` passes.
- [ ] `cd frontend && npm run i18n:check` passes.
- [ ] `cd frontend && npm run style:check` passes.
- [ ] `e2e/specs/gantt-drag-pan.spec.js` passes with the repo's e2e runner, with the remove-and-undo case and the tray-drop case.

## Risks

| # | Risk | Handling |
|---|---|---|
| U1 | Removing a task by mistake | Undo toast restores the exact old dates. It is guarded, so a task re-dated meanwhile is not overwritten. |
| U2 | Right-click on a sprint band, milestone or empty space | Only real task ids open our menu. Everything else keeps the browser menu. Covered by a test. |
| U3 | Menu open during a drag, zoom or pan, or a stale menu after re-render | It closes on all of those. Remove is disabled while a guard is busy. |
| U4 | A stale `groupByDueDateIndex` breaks List grouping after a clear | Fixed by the backend `$unset`. |
| U5 | The previous length is lost in another browser | Accepted. It falls back to 1 day. Listed in Out of scope. |
| U6 | A drop lands a day off around DST or midnight | Floor to local midnight and use calendar-day arithmetic, as in the `dragSnap` helpers. Covered by a DST case. |
| U7 | HTML5 drag does not work on touch | Accepted. The Schedule button stays as the touch and keyboard path. |
