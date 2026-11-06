<template>
    <div class="ah-page gv">
        <div v-if="isMobile" class="gv__mobile">
            <div class="ah-empty gv__mobile-card">
                <div class="gv__mobile-title">{{ $t('Views.desktop_only_title') }}</div>
                <p class="gv__mobile-text">{{ $t('Views.desktop_only_gantt') }}</p>
            </div>
        </div>

        <template v-else>
            <div class="gv__bar">
                <div class="ah-tabs gv__zoom">
                    <button
                        v-for="z in zoomLevels"
                        :key="z.key"
                        type="button"
                        class="ah-tab"
                        :class="{ 'is-on': zoom === z.key }"
                        @click="setZoom(z.key)"
                    >{{ z.label }}</button>
                </div>
                <button
                    type="button"
                    class="ah-btn ah-btn--sm gv__toggle"
                    :class="showCritical ? 'ah-btn--outline' : 'ah-btn--secondary'"
                    :aria-pressed="showCritical"
                    @click="toggleCritical"
                >{{ $t('Views.critical_path') }}</button>
                <button
                    type="button"
                    class="ah-btn ah-btn--sm gv__toggle"
                    :class="showBaseline ? 'ah-btn--outline' : 'ah-btn--secondary'"
                    :aria-pressed="showBaseline"
                    @click="toggleBaseline"
                >{{ $t('Views.baseline') }}</button>
                <span v-if="readOnly" class="ah-chip ah-chip--warn">{{ $t('Views.view_only') }}</span>
                <div class="ah-toolbar__spacer"></div>
                <span class="ah-mono gv__count">
                    {{ $t('Views.scheduled_count', { n: scheduled.length }) }}
                    <template v-if="unscheduled.length"> · {{ $t('Views.unscheduled_count', { n: unscheduled.length }) }}</template>
                </span>
                <button type="button" class="ah-btn ah-btn--outline ah-btn--sm" @click="replanOpen = !replanOpen">
                    <ShellIcon name="calendar" :size="13" class="gv__spark" /> {{ $t('Views.replan') }}
                </button>
            </div>

            <div class="gv__main">
                <div v-if="loadError" class="gv__msg ah-empty">
                    {{ $t('Views.gantt_module_missing') }}
                    <code>cd frontend &amp;&amp; npm install</code>
                </div>
                <template v-else>
                    <div ref="ganttEl" class="gv__chart"></div>
                    <EmptyState
                        v-if="!scheduled.length && !loading"
                        class="gv__empty"
                        compact
                        illustration="tasks"
                        data-test="gantt-empty"
                        :title="$t(noTasks ? 'Views.gantt_no_tasks_title' : 'Views.gantt_empty_title')"
                        :message="$t(noTasks ? 'Views.gantt_no_tasks_msg' : 'Views.gantt_empty')"
                        :actionLabel="noTasks ? $t('Views.add_a_task') : ''"
                        :actionAllowed="canAddFirstTask"
                        @action="goToList"
                    />
                </template>

                <aside v-if="unscheduled.length" class="gv__tray ah-scroll">
                    <div class="gv__tray-head">
                        <span class="ah-label">{{ $t('Views.unscheduled') }}</span>
                        <span class="ah-mono gv__tray-count">{{ unscheduled.length }}</span>
                    </div>
                    <div v-for="t in unscheduled" :key="t._id" class="gv__tray-item" @click="open(t)">
                        <span class="gv__tray-name" :title="t.TaskName">{{ t.TaskName || t.TaskKey }}</span>
                        <button v-if="canEditTaskDates(t)" type="button" class="ah-btn ah-btn--ghost ah-btn--sm" @click.stop="schedule(t)">
                            {{ $t('Views.schedule') }}
                        </button>
                    </div>
                </aside>

                <div v-if="replanOpen" class="gv__replan">
                    <button type="button" class="gv__replan-close" :aria-label="$t('Views.close')" @click="replanOpen = false">×</button>
                    <p v-for="(line, i) in replanLines" :key="i" class="gv__replan-line">
                        <span v-if="i === 0" class="gv__replan-tag">{{ $t('Views.replan') }}:</span> {{ line }}
                    </p>
                    <p v-for="p in proposals" :key="p._id" class="gv__replan-line">
                        <span class="gv__replan-tag">✦ {{ p.agentName }}:</span> {{ proposalTitle(t, p) }}
                        <router-link class="gv__replan-link" :to="{ name: 'AiInbox', params: { cid: companyId } }">{{ $t('Views.review') }}</router-link>
                    </p>
                </div>

                <div
                    v-if="shiftPreview"
                    ref="shiftEl"
                    class="gv__shift"
                    role="dialog"
                    aria-labelledby="gv-shift-title"
                    @keydown.esc="cancelShift"
                >
                    <p id="gv-shift-title" class="gv__shift-title">{{ $t('Views.shift_title', { task: taskLabel(shiftPreview.task) }) }}</p>
                    <template v-if="shiftRows.length">
                        <p class="gv__shift-text">{{ $t('Views.shift_intro', { n: shiftRows.length }, shiftRows.length) }}</p>
                        <ul class="gv__shift-list ah-scroll">
                            <li v-for="row in shiftRows" :key="row.id" class="gv__shift-row">
                                <span class="gv__shift-name" :title="row.name">{{ row.name }}</span>
                                <span class="ah-mono gv__shift-days">{{ $t(shiftDaysKey, { n: row.days }, row.days) }}</span>
                                <span class="ah-mono gv__shift-range">{{ row.range }}</span>
                            </li>
                        </ul>
                    </template>
                    <template v-if="conflictRows.length">
                        <p class="gv__shift-text">{{ $t('Views.shift_locked') }}</p>
                        <ul class="gv__shift-list ah-scroll">
                            <li v-for="row in conflictRows" :key="row.id" class="gv__shift-row">
                                <span class="gv__shift-name" :title="row.name">{{ row.name }}</span>
                                <span class="ah-mono gv__shift-days">{{ $t('Views.shift_needs', { days: $t(shiftDaysKey, { n: row.days }, row.days) }) }}</span>
                            </li>
                        </ul>
                    </template>
                    <p v-if="cycleChain" class="gv__shift-warn">{{ $t('Views.shift_cycle', { chain: cycleChain }) }}</p>
                    <p v-if="!everyDayWorks" class="gv__shift-note">{{ $t('Views.shift_working_note', { days: workingDayNames }) }}</p>
                    <p class="gv__shift-note">{{ $t('Views.shift_earlier') }}</p>
                    <div class="gv__shift-actions">
                        <button
                            v-if="shiftRows.length"
                            type="button"
                            class="ah-btn ah-btn--primary ah-btn--sm"
                            :disabled="shiftBusy"
                            @click="applyShift"
                        >{{ $t('Views.shift_apply') }}</button>
                        <button type="button" class="ah-btn ah-btn--outline ah-btn--sm" :disabled="shiftBusy" @click="moveOnly">{{ $t('Views.shift_only') }}</button>
                        <button type="button" class="ah-btn ah-btn--ghost ah-btn--sm" :disabled="shiftBusy" @click="cancelShift">{{ $t('Views.shift_cancel') }}</button>
                    </div>
                </div>
            </div>
        </template>
    </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount, inject, nextTick } from 'vue';
import ShellIcon from '@/components/organisms/Shell/ShellIcon.vue';
import { useStore } from 'vuex';
import { useI18n } from 'vue-i18n';
import { proposalTitle } from '@/views/Ai/plainLabels';
import { useCustomComposable, useGetterFunctions } from '@/composable';
import { apiRequest } from '@/services';
import * as env from '@/config/env';
import taskClass from '@/utils/TaskOperations';
import { readLookLength } from '@/utils/lookTokens';
import { taskListHelper } from '@/views/Projects/helper.js';
import { criticalPath } from '@/views/Projects/composables/criticalPath';
import { fsCollisionLinks } from '@/views/Projects/composables/ganttCollisions';
import { shiftDependants } from '@ganttShift';
import { workingDaysFor, countsEveryDay } from '@workingDays';
import { openTask } from '@/components/organisms/TaskDetailOverlay/useTaskOverlay';
import { showUndoToast } from '@/composable/useUndoToast';
import { datesForGanttDrag } from './dragDates';
import { growTimelineRange, includeTimelineDates, initialTimelineRange } from './timelineRange';
import EmptyState from '@/components/atom/EmptyState/EmptyState.vue';
import { useAddFirstTask } from '@/views/Projects/composables/useAddFirstTask';
import { useToast } from 'vue-toast-notification';
import { formatDisplayDate } from '@/views/Settings/Language/localePrefs';

defineOptions({ name: 'GanttView' });

const props = defineProps({
    projectData: { type: Object, default: () => ({}) },
    sprints: { type: Array, default: () => [] },
});

const store = useStore();
const { getters } = store;
const { t } = useI18n();
const { checkPermission } = useCustomComposable();
const { getUser } = useGetterFunctions();
const { groupBy } = taskListHelper();
const toast = useToast();
const selectedProject = inject('selectedProject', ref({}));
const { canAddFirstTask, goToList } = useAddFirstTask(selectedProject);
const companyId = inject('$companyId', ref(''));
const clientWidth = inject('$clientWidth', ref(1440));

const ganttEl = ref(null);
const loadError = ref(false);
const loading = ref(true);
const milestones = ref([]);
const proposals = ref([]);
const zoomLevels = computed(() => [
    { key: 'Day', label: t('Views.zoom_days') },
    { key: 'Week', label: t('Views.zoom_weeks') },
    { key: 'Month', label: t('Views.zoom_months') },
]);
const zoom = ref('Week');
const showCritical = ref(true);
const showBaseline = ref(true);
const replanOpen = ref(false);
const shiftPreview = ref(null);
const shiftBusy = ref(false);
const shiftEl = ref(null);

let gantt = null;     // dhtmlx instance (lazy-loaded)
let ready = false;    // init complete
let suppress = false; // guard: programmatic re-renders must not fire write handlers
let eventIds = [];
let baselineLayer = null;
let taskLoadInFlight = false;
const completedTaskLoads = new Set();
let timelineRange = { startDate: null, endDate: null };
let timelinePanning = false;
let taskDragInProgress = false;
let renderDeferred = false;
let scrollCheckScheduled = false;
let activeTaskDragSnapshot = null;
let viewportRestoreVersion = 0;
let pendingInitialViewport = null;
let panPointerDownHandler = null;
let panPointerUpHandler = null;
let viewportWheelHandler = null;
let scrollbarPointerDownHandler = null;
let windowBlurHandler = null;
let viewportInteractionRoot = null;
let dateBatchWriteCount = 0;
const pendingDateWrites = new Set();

const isMobile = computed(() => Number(clientWidth.value || 0) > 0 && Number(clientWidth.value) < 768);

/* ----------------------- data in: from the live Vuex store ----------------------- */
// Same task source the List/Table views use, so socket-driven updates flow in for free.
const sprintIds = computed(() => (props.sprints || []).map((s) => String((s && (s.id || s._id)) || '')).filter(Boolean));

function pickTasks(map) {
    const pid = props.projectData?._id;
    if (!pid || !map || !map[pid]) return [];
    const byProject = map[pid];
    const ids = sprintIds.value.length ? sprintIds.value : Object.keys(byProject);
    return ids.reduce((all, sid) => {
        const node = byProject[sid];
        return Array.isArray(node?.tasks) ? all.concat(node.tasks) : all;
    }, []);
}
const tasks = computed(() => {
    const merged = [...pickTasks(getters['projectData/tasks']), ...pickTasks(getters['projectData/tableTasks'])];
    const seen = new Set();
    return merged.filter((task) => {
        const id = String(task?._id || '');
        if (!id || seen.has(id)) return false;
        seen.add(id);
        return true;
    });
});

// active = not deleted (0 active, 2 archived, undefined legacy)
const activeTasks = computed(() => tasks.value.filter((task) => task && [0, 2, undefined, null].includes(task.deletedStatusKey)));
const noTasks = computed(() => !activeTasks.value.length);
const scheduled = computed(() => activeTasks.value.filter((task) => task.startDate && task.DueDate));
const unscheduled = computed(() => activeTasks.value.filter((task) => !(task.startDate && task.DueDate)));

const readOnly = computed(() =>
    checkPermission('task.task_due_date', selectedProject.value?.isGlobalPermission ?? props.projectData?.isGlobalPermission) !== true
);

const sprintName = (id) => {
    const hit = (props.sprints || []).find((s) => String(s.id || s._id) === String(id));
    return (hit && (hit.name || hit.sprintName)) || t('Views.sprint_fallback');
};

const blocksOf = (task) => (task.relations || []).filter((r) => r.type === 'blocks').map((r) => String(r.taskId));

const workingDays = computed(() => workingDaysFor(getters['settings/selectedCompany'], props.projectData));
const everyDayWorks = computed(() => countsEveryDay(workingDays.value));
const shiftDaysKey = computed(() => (everyDayWorks.value ? 'Views.shift_days' : 'Views.shift_working_days'));
const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const MONDAY_FIRST = [1, 2, 3, 4, 5, 6, 0];
const workingDayNames = computed(() => MONDAY_FIRST.filter((day) => workingDays.value.includes(day))
    .map((day) => t(`weekName.${WEEKDAY_KEYS[day]}`)).join(', '));
/* Only the day scale has a column per day; a week column cannot be a day off. */
const dayOffClass = (date) => (zoom.value === 'Day' && !workingDays.value.includes(date.getDay()) ? 'gv-off' : '');

const critical = computed(() => criticalPath(scheduled.value.map((task) => ({
    id: String(task._id), startDate: task.startDate, DueDate: task.DueDate, blocks: blocksOf(task),
})), { workingDays: workingDays.value }));
// The toggle decides what is painted, not what is known: Replan reads the chain either way.
const criticalIds = computed(() => (showCritical.value ? new Set(critical.value.path) : new Set()));
const collisionLinks = computed(() => fsCollisionLinks(scheduled.value.map((task) => ({
    id: String(task._id), startDate: task.startDate, DueDate: task.DueDate, blocks: blocksOf(task),
}))));

const shortDate = (value) => formatDisplayDate(value, 'MMM D');
const taskLabel = (task) => (task && (task.TaskName || task.TaskKey)) || t('Views.untitled');
const labelOf = (id) => taskLabel(findTask(id));
const shiftRows = computed(() => (shiftPreview.value?.shifts || []).map((shift) => ({
    id: shift.id,
    name: labelOf(shift.id),
    days: shift.days,
    range: `${shortDate(shift.to.startDate)} – ${shortDate(shift.to.DueDate)}`,
})));
const conflictRows = computed(() => (shiftPreview.value?.conflicts || []).map((conflict) => ({ id: conflict.id, name: labelOf(conflict.id), days: conflict.days })));
const cycleChain = computed(() => (shiftPreview.value?.cycle || []).map(labelOf).join(' → '));

/* The last dated plan the task carried before this one. Only a real earlier date
 * counts — an invented baseline would read as a slip that never happened. */
const baselineEnd = (task) => {
    const history = Array.isArray(task.dueDateDeadLine) ? task.dueDateDeadLine : [];
    const first = history
        .map((entry) => {
            const value = typeof entry === 'string' ? (() => { try { return JSON.parse(entry); } catch (e) { return null; } })() : entry;
            const date = value && (value.date || value);
            const time = date ? new Date(date.seconds ? date.seconds * 1000 : date).getTime() : NaN;
            return Number.isNaN(time) ? null : time;
        })
        .filter(Boolean)
        .sort((a, b) => a - b)[0];
    if (!first) return null;
    return first < new Date(task.DueDate).getTime() ? new Date(first) : null;
};

// Re-render only when something the chart actually shows has changed.
const signature = computed(() =>
    JSON.stringify(scheduled.value.map((task) => [
        task._id, task.TaskName, task.startDate, task.DueDate, task.ParentTaskId || 0, task.sprintId || '',
        task.status?.type || task.statusType || '', task.Task_Leader || '', task.deletedStatusKey,
        blocksOf(task),
    ]))
);

/* ----------------------------------- helpers ----------------------------------- */
function progressOf(task) {
    const type = task?.status?.type || task?.statusType;
    if (type === 'close') return 1;
    if (type === 'inprogress') return 0.5;
    return 0;
}
function findTask(id) { return activeTasks.value.find((task) => String(task._id) === String(id)); }
function buildProjectData() {
    const p = props.projectData || {};
    return { _id: p._id, ProjectName: p.ProjectName, CompanyId: p.CompanyId };
}
function buildUserData() {
    const uid = localStorage.getItem('userId');
    const me = (getters['users/users'] || []).find((u) => String(u._id) === String(uid)) || {};
    return { Employee_Name: me.Employee_Name || '', id: uid, companyOwnerId: getters['settings/companyOwnerDetail']?.userId || '' };
}
function open(task) {
    if (!task || !task._id) return;
    openTask({
        companyId: companyId.value,
        projectId: task.ProjectID || props.projectData?._id,
        sprintId: task.sprintId,
        folderId: task.folderObjId || task.sprintArray?.folderId || '',
        taskId: task._id,
    });
}

function toGanttData() {
    const data = scheduled.value.map((task) => {
        const parent = task.ParentTaskId ? String(task.ParentTaskId) : '';
        const sprintGroup = task.sprintId ? `sp_${task.sprintId}` : 0;
        const line = baselineEnd(task);
        return {
            id: String(task._id),
            text: task.TaskName || task.TaskKey || t('Views.untitled'),
            start_date: new Date(task.startDate),
            end_date: new Date(task.DueDate),
            sprintGroup,
            parent: parent || sprintGroup,
            progress: progressOf(task),
            open: true,
            owner: task.Task_Leader || (Array.isArray(task.AssigneeUserId) ? task.AssigneeUserId[0] : '') || '',
            baseline_end: line,
            critical: criticalIds.value.has(String(task._id)),
            readonly: readOnly.value || task.deletedStatusKey === 2,
        };
    });
    const ids = new Set(data.map((d) => d.id));
    // A parent outside the visible set would make dhtmlx throw; the task falls back
    // to its sprint band.
    data.forEach((d) => {
        if (d.parent && !String(d.parent).startsWith('sp_') && !ids.has(String(d.parent))) {
            d.parent = d.sprintGroup || 0;
        }
    });
    // Sprint bands exist only where something actually sits under them — an empty
    // project row has no dates to derive and dhtmlx renders it as NaN.
    const groups = [...new Set(data.map((d) => d.parent).filter((p) => String(p).startsWith('sp_')))]
        .map((groupId) => ({
            id: groupId,
            text: sprintName(String(groupId).slice(3)),
            type: gantt?.config?.types?.project || 'project',
            open: true,
            parent: 0,
            readonly: true,
        }));

    // dependency arrows: only emit from the 'blocks' side (relations are stored
    // bidirectionally, so this avoids duplicate links). 'blocks' => finish-to-start ('0').
    const links = [];
    scheduled.value.forEach((task) => {
        blocksOf(task).forEach((target) => {
            if (ids.has(String(task._id)) && ids.has(target)) {
                links.push({ id: `${task._id}_${target}`, source: String(task._id), target, type: '0' });
            }
        });
    });
    // Project milestones as read-only diamond markers.
    (milestones.value || []).forEach((m) => {
        if (m && m.date) {
            data.push({
                id: `ms_${m._id}`,
                text: m.milestoneName || t('Views.milestone'),
                start_date: new Date(m.date),
                type: (gantt && gantt.config && gantt.config.types ? gantt.config.types.milestone : 'milestone'),
                readonly: true,
                parent: 0,
            });
        }
    });
    return { data: groups.concat(data), links };
}

const validDate = (value) => value instanceof Date && Number.isFinite(value.getTime());
const sameDate = (left, right) => left?.getTime() === right?.getTime();
const sameDateInstant = (left, right) => {
    const leftTime = new Date(left).getTime();
    const rightTime = new Date(right).getTime();
    return Number.isFinite(leftTime) && leftTime === rightTime;
};

function timelineDates() {
    const dates = [];
    scheduled.value.forEach((task) => {
        [task.startDate, task.DueDate].forEach((value) => {
            const date = new Date(value);
            if (validDate(date)) dates.push(date);
        });
    });
    milestones.value.forEach((milestone) => {
        const date = new Date(milestone.date);
        if (validDate(date)) dates.push(date);
    });
    return dates;
}

function datesWithViewportBuffer(dates, visible = visibleTimelineDates()) {
    if (!visible || !dates.length) return dates;
    const padded = initialTimelineRange({
        taskDates: dates,
        viewportStart: visible.start,
        viewportEnd: visible.end,
    });
    return [...dates, padded.startDate, padded.endDate].filter(validDate);
}

function visibleTimelineDates() {
    if (!gantt || typeof gantt.getScrollState !== 'function' || typeof gantt.dateFromPos !== 'function') return null;
    const scroll = gantt.getScrollState();
    const left = Number(scroll?.x) || 0;
    const viewportWidth = Number(gantt.$task?.clientWidth);
    const stateWidth = Number(scroll?.inner_width);
    const width = viewportWidth > 1 ? viewportWidth : (stateWidth > 1 ? stateWidth : 0);
    if (!width) return null;
    const start = gantt.dateFromPos(left);
    const end = gantt.dateFromPos(left + width);
    return validDate(start) && validDate(end) && end > start ? { start, end } : null;
}

function captureViewportAnchor() {
    if (!gantt || typeof gantt.getScrollState !== 'function') return null;
    const scroll = gantt.getScrollState();
    if (pendingInitialViewport?.date) {
        return { date: new Date(pendingInitialViewport.date), y: pendingInitialViewport.y };
    }
    let date = null;
    try { date = gantt.dateFromPos(Number(scroll?.x) || 0); } catch (e) { /* chart is not ready */ }
    return { date: validDate(date) ? date : null, y: Number(scroll?.y) || 0 };
}

function restoreViewport(anchor) {
    if (!anchor || !gantt || typeof gantt.scrollTo !== 'function') return;
    const version = ++viewportRestoreVersion;
    const restore = () => {
        if (!gantt || !ready || version !== viewportRestoreVersion) return;
        const x = anchor.date && typeof gantt.posFromDate === 'function' ? gantt.posFromDate(anchor.date) : undefined;
        gantt.scrollTo(x, anchor.y);
        if (pendingInitialViewport?.date && anchor.date?.getTime() === pendingInitialViewport.date.getTime()) {
            pendingInitialViewport = null;
        }
    };
    // Range growth can reflow the timeline while DHTMLX is processing a drag.
    // Restore synchronously so the active gesture keeps its date and row under
    // the pointer; delayed restoration would either be dropped or snap back to
    // an anchor from before the user finished panning.
    if (timelinePanning || taskDragInProgress) {
        restore();
        return;
    }
    const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (callback) => setTimeout(callback, 0);
    raf(() => raf(restore));
}

function setTimelineRange(next, { anchor = null, render = true } = {}) {
    if (!validDate(next?.startDate) || !validDate(next?.endDate)) return false;
    if (sameDate(next.startDate, timelineRange.startDate) && sameDate(next.endDate, timelineRange.endDate)) return false;
    timelineRange = { startDate: new Date(next.startDate), endDate: new Date(next.endDate) };
    if (gantt?.config) {
        gantt.config.start_date = new Date(timelineRange.startDate);
        gantt.config.end_date = new Date(timelineRange.endDate);
    }
    if (render && gantt) {
        gantt.render();
        restoreViewport(anchor || captureViewportAnchor());
    }
    return true;
}

function extendTimelineAtViewport() {
    if (!ready || !gantt || !validDate(timelineRange.startDate) || !validDate(timelineRange.endDate)) return false;
    const visible = visibleTimelineDates();
    if (!visible) return false;
    const next = growTimelineRange({
        rangeStart: timelineRange.startDate,
        rangeEnd: timelineRange.endDate,
        visibleStart: visible.start,
        visibleEnd: visible.end,
    });
    if (sameDate(next.startDate, timelineRange.startDate) && sameDate(next.endDate, timelineRange.endDate)) return false;
    const anchor = captureViewportAnchor();
    return setTimelineRange(next, { anchor });
}

function ensureTimelineForDraggedTask(task) {
    if (!task || !validDate(task.start_date) || !validDate(task.end_date)) return;
    const visible = visibleTimelineDates();
    const draggedDates = datesWithViewportBuffer([task.start_date, task.end_date], visible);
    const next = includeTimelineDates({
        rangeStart: timelineRange.startDate,
        rangeEnd: timelineRange.endDate,
        taskDates: draggedDates,
    });
    if (!validDate(next.startDate) || !validDate(next.endDate)) return;
    if (sameDate(next.startDate, timelineRange.startDate) && sameDate(next.endDate, timelineRange.endDate)) {
        extendTimelineAtViewport();
        return;
    }
    const padded = visible ? growTimelineRange({
        rangeStart: next.startDate,
        rangeEnd: next.endDate,
        visibleStart: visible.start,
        visibleEnd: visible.end,
    }) : next;
    setTimelineRange(padded, { anchor: captureViewportAnchor() });
}

function scheduleViewportRangeCheck() {
    // Keep this active during timeline panning: its `render()` grows the scrollable range without reparsing tasks.
    if (scrollCheckScheduled || !ready || taskDragInProgress) return;
    scrollCheckScheduled = true;
    const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (callback) => setTimeout(callback, 0);
    raf(() => {
        scrollCheckScheduled = false;
        if (!taskDragInProgress) extendTimelineAtViewport();
    });
}

function flushDeferredRender() {
    if (!renderDeferred || timelinePanning || taskDragInProgress) return;
    renderDeferred = false;
    nextTick(() => renderData());
}

function attachTimelinePanGuard() {
    const timeline = gantt?.$task;
    if (!timeline || typeof document === 'undefined') return;
    viewportInteractionRoot = gantt?.$root || gantt?.$container || timeline;
    const invalidatePendingRestore = () => { viewportRestoreVersion += 1; };
    panPointerDownHandler = (event) => {
        if (event.button !== 0 || event.target?.closest?.('.gantt_task_line, .gantt_task_link')) return;
        pendingInitialViewport = null;
        timelinePanning = true;
        invalidatePendingRestore();
    };
    panPointerUpHandler = () => {
        if (!timelinePanning) return;
        timelinePanning = false;
        scheduleViewportRangeCheck();
        flushDeferredRender();
    };
    windowBlurHandler = () => {
        const hadGesture = timelinePanning || taskDragInProgress;
        timelinePanning = false;
        if (taskDragInProgress) {
            taskDragInProgress = false;
            activeTaskDragSnapshot = null;
            renderDeferred = true;
        }
        if (hadGesture) {
            scheduleViewportRangeCheck();
            flushDeferredRender();
        }
    };
    viewportWheelHandler = () => {
        pendingInitialViewport = null;
        invalidatePendingRestore();
    };
    scrollbarPointerDownHandler = (event) => {
        if (event.target?.closest?.('.gantt_hor_scroll, .gantt_ver_scroll')) {
            pendingInitialViewport = null;
            invalidatePendingRestore();
        }
    };
    timeline.addEventListener('mousedown', panPointerDownHandler, true);
    viewportInteractionRoot.addEventListener('wheel', viewportWheelHandler, true);
    viewportInteractionRoot.addEventListener('mousedown', scrollbarPointerDownHandler, true);
    document.addEventListener('mouseup', panPointerUpHandler, true);
    document.addEventListener('pointerup', panPointerUpHandler, true);
    window.addEventListener('blur', windowBlurHandler);
}

function detachTimelinePanGuard() {
    if (panPointerDownHandler) gantt?.$task?.removeEventListener('mousedown', panPointerDownHandler, true);
    if (viewportWheelHandler) viewportInteractionRoot?.removeEventListener('wheel', viewportWheelHandler, true);
    if (scrollbarPointerDownHandler) viewportInteractionRoot?.removeEventListener('mousedown', scrollbarPointerDownHandler, true);
    if (panPointerUpHandler && typeof document !== 'undefined') {
        document.removeEventListener('mouseup', panPointerUpHandler, true);
        document.removeEventListener('pointerup', panPointerUpHandler, true);
        window.removeEventListener('blur', windowBlurHandler);
    }
    panPointerDownHandler = null;
    panPointerUpHandler = null;
    viewportWheelHandler = null;
    scrollbarPointerDownHandler = null;
    windowBlurHandler = null;
    viewportInteractionRoot = null;
    timelinePanning = false;
}

function renderData() {
    if (!ready || !gantt) return;
    if (timelinePanning || taskDragInProgress) {
        renderDeferred = true;
        return;
    }
    let anchor = captureViewportAnchor();
    const dates = timelineDates();
    const oldRange = timelineRange;
    if (validDate(oldRange.startDate) && validDate(oldRange.endDate)) {
        const bufferedDates = datesWithViewportBuffer(dates);
        setTimelineRange(includeTimelineDates({
            rangeStart: oldRange.startDate,
            rangeEnd: oldRange.endDate,
            taskDates: bufferedDates,
        }), { render: false });
    }
    suppress = true;
    try {
        gantt.clearAll();
        gantt.parse(toGanttData());
        if ((!validDate(timelineRange.startDate) || !validDate(timelineRange.endDate)) && dates.length) {
            const visible = visibleTimelineDates();
            const state = typeof gantt.getState === 'function' ? gantt.getState() : {};
            const viewportStart = visible?.start || (validDate(state.min_date) ? state.min_date : new Date());
            const viewportEnd = visible?.end || (validDate(state.max_date) && state.max_date > viewportStart ? state.max_date : new Date(viewportStart));
            const initial = initialTimelineRange({ taskDates: dates, viewportStart, viewportEnd });
            setTimelineRange(initial, { render: false });
            const firstScheduledDate = dates.reduce((first, date) => (!first || date < first ? date : first), null);
            if (firstScheduledDate) pendingInitialViewport = { date: new Date(firstScheduledDate), y: anchor?.y || 0 };
            gantt.render();
        }
        if (pendingInitialViewport?.date) {
            // Keep the initial date as the anchor until its deferred restore
            // completes. Another store or milestone render can happen before
            // that restore and must not replace the target with a stale read.
            if (typeof gantt.showDate === 'function') gantt.showDate(pendingInitialViewport.date);
            anchor = { date: new Date(pendingInitialViewport.date), y: pendingInitialViewport.y };
        }
        placeToday();
    } finally {
        suppress = false;
    }
    restoreViewport(anchor);
}

let todayMarker = null;
function placeToday() {
    if (!gantt || typeof gantt.addMarker !== 'function') return;
    try {
        if (todayMarker) gantt.deleteMarker(todayMarker);
        todayMarker = gantt.addMarker({ start_date: new Date(), css: 'gv-today', text: t('Views.today') });
    } catch (e) { /* markers are decoration */ }
}

function saveDates(task, dates) {
    const taskId = String(task?._id || '');
    if (!taskId || pendingDateWrites.has(taskId)) return;
    pendingDateWrites.add(taskId);
    taskClass.updateDates({
        firebaseObj: dates,
        projectData: buildProjectData(),
        taskData: task,
        userData: buildUserData(),
    }).catch((e) => {
        console.error('Gantt: updateDates failed', e);
        toast.error(t('Views.shift_failed'));
        renderData();
    }).finally(() => {
        pendingDateWrites.delete(taskId);
        flushDeferredRender();
    });
}

/* The batch write leaves archived tasks out, so they are never offered as shiftable. */
const canEditTaskDates = (task) => !readOnly.value && task?.deletedStatusKey !== 2;
const mayShift = (id) => canEditTaskDates(findTask(id));

function calculateShiftPlan(id, to) {
    return shiftDependants(
        scheduled.value.map((row) => ({ id: String(row._id), startDate: row.startDate, DueDate: row.DueDate })),
        scheduled.value.flatMap((row) => blocksOf(row).map((target) => ({ source: String(row._id), target }))),
        String(id),
        to,
        { canEdit: mayShift, workingDays: workingDays.value },
    );
}

function shiftPlanSignature(plan) {
    const stamp = (value) => {
        const date = new Date(value);
        return validDate(date) ? date.getTime() : null;
    };
    return JSON.stringify({
        shifts: (plan?.shifts || []).map((shift) => ({
            id: String(shift.id),
            from: [stamp(shift.from?.startDate), stamp(shift.from?.DueDate)],
            to: [stamp(shift.to?.startDate), stamp(shift.to?.DueDate)],
            days: shift.days,
        })).sort((left, right) => left.id.localeCompare(right.id)),
        conflicts: (plan?.conflicts || []).map((conflict) => ({ id: String(conflict.id), days: conflict.days }))
            .sort((left, right) => left.id.localeCompare(right.id)),
        cycle: plan?.cycle || [],
    });
}

function onTaskDragged(id, mode) {
    const snapshot = activeTaskDragSnapshot;
    activeTaskDragSnapshot = null;
    taskDragInProgress = false;
    if (suppress) { flushDeferredRender(); return; }
    const g = gantt.getTask(id);
    const task = findTask(id);
    if (!g || !task || !snapshot || snapshot.id !== String(id) || !canEditTaskDates(task)
        || !sameDateInstant(task.startDate, snapshot.stored.startDate)
        || !sameDateInstant(task.DueDate, snapshot.stored.DueDate)) {
        renderData();
        flushDeferredRender();
        return;
    }
    const to = datesForGanttDrag({
        mode,
        dragModes: gantt.config.drag_mode || {},
        original: snapshot.original,
        dragged: g,
        stored: snapshot.stored,
    });
    if (!to) {
        const dragModes = gantt.config.drag_mode || {};
        const supportedMode = mode === dragModes.move || mode === dragModes.resize;
        if (supportedMode && zoom.value !== 'Day') toast.info(t('Views.drag_snapped_back'));
        renderData();
        flushDeferredRender();
        return;
    }
    const plan = calculateShiftPlan(id, to);
    if (!plan.shifts.length && !plan.conflicts.length && !plan.cycle.length) {
        saveDates(task, to);
        flushDeferredRender();
        return;
    }
    shiftPreview.value = {
        id: String(id), task, from: { startDate: task.startDate, DueDate: task.DueDate }, to, ...plan,
    };
    nextTick(() => shiftEl.value?.querySelector('button')?.focus());
    flushDeferredRender();
}

function writeDates(rows) {
    dateBatchWriteCount += 1;
    return taskClass.updateDatesBatch({ rows, userData: buildUserData() }).finally(() => {
        dateBatchWriteCount = Math.max(0, dateBatchWriteCount - 1);
    });
}

function currentShiftTask(plan) {
    const task = findTask(plan?.id);
    if (!task || !canEditTaskDates(task)
        || !sameDateInstant(task.startDate, plan.from?.startDate)
        || !sameDateInstant(task.DueDate, plan.from?.DueDate)) return null;
    return task;
}

function currentShiftDependants(plan) {
    return (plan?.shifts || []).map((shift) => {
        const task = findTask(shift.id);
        if (!task || !canEditTaskDates(task)
            || !sameDateInstant(task.startDate, shift.from?.startDate)
            || !sameDateInstant(task.DueDate, shift.from?.DueDate)) return null;
        return { task, ...shift.to };
    });
}

function restoreDates(before, expectedAfter) {
    const expectedById = new Map((expectedAfter || []).map((row) => [String(row.id), row]));
    const rows = before.flatMap(({ id, startDate, DueDate }) => {
        const task = findTask(id);
        const expected = expectedById.get(String(id));
        if (!task || !expected
            || !sameDateInstant(task.startDate, expected.startDate)
            || !sameDateInstant(task.DueDate, expected.DueDate)) return [];
        return [{ task, startDate, DueDate }];
    });
    if (rows.length < before.length) toast.error(t('Views.shift_failed'));
    if (!rows.length) return Promise.resolve();
    return writeDates(rows).catch((e) => {
        console.error('Gantt: undo shift failed', e);
        toast.error(t('Views.shift_undo_failed'));
    });
}

async function applyShift() {
    const plan = shiftPreview.value;
    if (!plan || shiftBusy.value) return;
    const rootTask = currentShiftTask(plan);
    const dependants = currentShiftDependants(plan);
    if (!rootTask || dependants.some((row) => !row)) {
        shiftPreview.value = null;
        toast.error(t('Views.shift_failed'));
        renderData();
        return;
    }
    const latestPlan = calculateShiftPlan(plan.id, plan.to);
    if (shiftPlanSignature(latestPlan) !== shiftPlanSignature(plan)) {
        // Keep the updated preview visible and require a second confirmation
        // if links, permissions, or dates changed while the user was deciding.
        shiftPreview.value = { ...plan, ...latestPlan };
        return;
    }
    shiftBusy.value = true;
    const rows = [{ task: rootTask, ...plan.to }, ...dependants];
    const before = rows.map(({ task }) => ({ id: String(task._id), startDate: task.startDate, DueDate: task.DueDate }));
    const expectedAfter = rows.map(({ task, startDate, DueDate }) => ({ id: String(task._id), startDate, DueDate }));
    try {
        await writeDates(rows);
        showUndoToast({
            message: t('Views.shift_done', { task: taskLabel(rootTask), n: plan.shifts.length }, plan.shifts.length),
            undo: () => restoreDates(before, expectedAfter),
        });
    } catch (e) {
        console.error('Gantt: shift failed', e);
        toast.error(t('Views.shift_failed'));
        renderData();
    } finally {
        shiftBusy.value = false;
        shiftPreview.value = null;
    }
}

function moveOnly() {
    const plan = shiftPreview.value;
    if (!plan || shiftBusy.value) return;
    const task = currentShiftTask(plan);
    if (!task) {
        shiftPreview.value = null;
        toast.error(t('Views.shift_failed'));
        renderData();
        return;
    }
    shiftPreview.value = null;
    saveDates(task, plan.to);
}

function cancelShift() {
    if (shiftBusy.value) return;
    shiftPreview.value = null;
    renderData();
}

function persistLinkAdd(id, link) {
    if (suppress) return;
    apiRequest('post', '/api/v2/tasks/relations', {
        action: 'add', taskId: link.source, relatedTaskId: link.target, type: 'blocks', userData: buildUserData(),
    }).then((res) => {
        if (!res?.data?.status) rollbackLink(id);
    }).catch((e) => {
        console.error('Gantt: link add failed', e);
        rollbackLink(id);
    });
}
function rollbackLink(id) {
    suppress = true;
    try { gantt.deleteLink(id); } catch (e) { /* ignore */ } finally { suppress = false; }
}
function persistLinkDelete(link) {
    if (suppress) return;
    apiRequest('post', '/api/v2/tasks/relations', {
        action: 'remove', taskId: link.source, relatedTaskId: link.target, userData: buildUserData(),
    }).catch((e) => console.error('Gantt: link remove failed', e));
}
function schedule(task) {
    if (!canEditTaskDates(task)) return;
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const end = new Date(start); end.setDate(end.getDate() + 1);
    taskClass.updateDates({
        firebaseObj: { startDate: start, DueDate: end },
        projectData: buildProjectData(),
        taskData: task,
        userData: buildUserData(),
    }).catch((e) => console.error('Gantt: schedule failed', e));
}

/* ------------------------------------- zoom ------------------------------------- */
// dhtmlx lays its rows out in pixels: the List's row height for the look, 36px where a look names none.
const lookRowHeight = () => readLookLength('--row-h', 36);

function applyScales(level) {
    if (!gantt) return;
    gantt.config.scale_height = lookRowHeight() - 2;
    if (level === 'Day') {
        gantt.config.scales = [
            { unit: 'day', step: 1, format: '%d %M' },
            { unit: 'hour', step: 6, format: '%H:%i' },
        ];
    } else if (level === 'Month') {
        gantt.config.scales = [
            { unit: 'month', step: 1, format: '%F %Y' },
            { unit: 'week', step: 1, format: 'W%W' },
        ];
    } else {
        gantt.config.scales = [{ unit: 'week', step: 1, format: '%M %d' }];
    }
}
function setZoom(level) {
    const anchor = captureViewportAnchor();
    pendingInitialViewport = null;
    zoom.value = level;
    applyScales(level);
    if (ready && gantt) {
        gantt.render();
        restoreViewport(anchor);
    }
}
function toggleCritical() {
    showCritical.value = !showCritical.value;
    renderData();
}
function toggleBaseline() {
    showBaseline.value = !showBaseline.value;
    if (ready && gantt) gantt.render();
}

/* --------------------------------- replan panel --------------------------------- */
const replanLines = computed(() => {
    const path = critical.value.path || [];
    if (!path.length) return [t('Views.replan_none')];
    const chain = path.map((id) => findTask(id)).filter(Boolean);
    const last = chain[chain.length - 1];
    const end = last ? new Date(last.DueDate) : null;
    const span = critical.value.durationDays;
    const lines = [t(everyDayWorks.value ? 'Views.replan_chain' : 'Views.replan_chain_working', {
        n: chain.length,
        days: t(everyDayWorks.value ? 'Views.days_count' : 'Views.working_days_count', { n: span }, span),
        date: end ? formatDisplayDate(end, 'MMM D') : '',
    }, chain.length)];
    const now = Date.now();
    const late = chain.find((task) => new Date(task.DueDate).getTime() < now && (task.status?.type || task.statusType) !== 'close');
    if (late) lines.push(t('Views.replan_late', { task: late.TaskName || late.TaskKey }));
    return lines;
});

/* ----------------------------------- lifecycle ---------------------------------- */
// Ensure the project's task list is in the store. Other views (List/Table/Board) trigger
// this load via taskListHelper on mount; Gantt must too — otherwise a direct reload INTO
// the Gantt tab finds an empty store and renders nothing (it only worked when another view
// had already populated it). Mirrors ListView's onMounted loader (state.tasks via Mongo).
function ensureTasksLoaded() {
    const proj = (selectedProject.value && selectedProject.value._id) ? selectedProject.value : props.projectData;
    if (!proj || !proj._id || !Array.isArray(props.sprints) || !props.sprints.length) return;
    const key = `${proj._id}:${sprintIds.value.slice().sort().join(',')}`;
    if (taskLoadInFlight || completedTaskLoads.has(key)) return;
    taskLoadInFlight = true;
    Promise.resolve(groupBy(0, true, proj, props.sprints, ref([]), false, 'list', false, true, () => {}, {
        allSprints: true,
        allPages: true,
    })).then((loaded) => {
        if (loaded) completedTaskLoads.add(key);
    }).catch((e) => {
        console.error('Gantt: task-load trigger failed', e);
    }).finally(() => {
        taskLoadInFlight = false;
        const currentProject = (selectedProject.value && selectedProject.value._id) ? selectedProject.value : props.projectData;
        const currentKey = currentProject?._id ? `${currentProject._id}:${sprintIds.value.slice().sort().join(',')}` : '';
        if (currentKey && currentKey !== key && !completedTaskLoads.has(currentKey)) ensureTasksLoaded();
    });
}

function ownerCell(task) {
    if (!task || String(task.id).startsWith('sp_') || String(task.id).startsWith('ms_')) return '';
    if (!task.owner) return `<span class="gv-unassigned">${t('Views.unassigned')}</span>`;
    const user = getUser(task.owner) || {};
    const name = user.Employee_Name || '';
    return `<span class="gv-owner" title="${name.replace(/"/g, '')}">${(name.trim().charAt(0) || '?').toUpperCase()}</span>`;
}

onMounted(async () => {
    if (isMobile.value) { loading.value = false; return; }
    ensureTasksLoaded();
    loadProposals();
    let mod;
    try {
        mod = await import(/* webpackChunkName: "dhtmlx-gantt" */ 'dhtmlx-gantt');
    } catch (e) {
        console.error('Gantt: failed to load dhtmlx-gantt', e);
        loadError.value = true;
        loading.value = false;
        return;
    }
    try { await import(/* webpackChunkName: "dhtmlx-gantt-css" */ 'dhtmlx-gantt/codebase/dhtmlxgantt.css'); } catch (e) { /* styling only */ }

    // Use the dhtmlx singleton (fully initialised on import). We deliberately do NOT
    // call getGanttInstance()/destructor(): re-initialising a destructed instance throws
    // "Cannot read properties of undefined (reading 'tasksStore')" when the Gantt tab is
    // reopened. We re-init the singleton each mount, detaching handlers + clearing on unmount.
    gantt = mod.gantt || mod.default || mod;

    await nextTick();
    if (!ganttEl.value || !gantt) { loading.value = false; return; }

    try {
        if (typeof gantt.plugins === 'function') gantt.plugins({ drag_timeline: true });
        // 'auto' probes with new Function and, where nothing blocks it, builds its date formatters with it,
        // so a report-only content security policy would log an eval on every Gantt view.
        gantt.config.csp = true;
        gantt.config.date_format = '%Y-%m-%d %H:%i';
        gantt.config.readonly = readOnly.value;
        gantt.config.drag_move = !readOnly.value;
        gantt.config.drag_resize = !readOnly.value;
        gantt.config.drag_links = !readOnly.value;
        gantt.config.drag_progress = false;
        gantt.config.fit_tasks = false;
        delete gantt.config.start_date;
        delete gantt.config.end_date;
        // The plugin writes its defaults when activated, so configure it afterwards.
        // Empty timeline space pans; task bars and dependency links keep their own gestures.
        gantt.config.drag_timeline = { ignore: '.gantt_task_line, .gantt_task_link', useKey: false };
        gantt.config.row_height = lookRowHeight();
        gantt.config.bar_height = 16;
        gantt.config.show_markers = true;
        gantt.config.columns = [
            { name: 'text', label: t('Views.col_task'), tree: true, width: 236, resize: true },
            { name: 'owner', label: '', align: 'center', width: 48, template: ownerCell },
        ];
        gantt.templates.task_text = () => '';
        gantt.templates.task_class = (start, end, task) => {
            const classes = [];
            if (String(task.id).startsWith('sp_')) classes.push('gv-group');
            if (task.critical) classes.push('gv-critical');
            return classes.join(' ');
        };
        gantt.templates.grid_row_class = (start, end, task) => (String(task.id).startsWith('sp_') ? 'gv-grid-group' : '');
        gantt.templates.link_class = (link) => {
            const classes = [];
            if (criticalIds.value.has(String(link.source)) && criticalIds.value.has(String(link.target))) classes.push('gv-link-critical');
            if (collisionLinks.value.has(`${link.source}_${link.target}`)) classes.push('gv-link-collision');
            return classes.join(' ');
        };
        gantt.templates.timeline_cell_class = (task, date) => dayOffClass(date);
        gantt.templates.scale_cell_class = (date) => dayOffClass(date);
        applyScales(zoom.value);

        gantt.init(ganttEl.value);
        attachTimelinePanGuard();

        // Baseline runs as its own layer so the actual bar keeps dhtmlx's own drag maths.
        if (typeof gantt.addTaskLayer === 'function') {
            baselineLayer = gantt.addTaskLayer((task) => {
                if (!showBaseline.value || !task.baseline_end || !task.start_date) return false;
                const el = document.createElement('div');
                el.className = 'gv-baseline';
                const left = gantt.posFromDate(task.start_date);
                const right = gantt.posFromDate(task.baseline_end);
                el.style.left = `${Math.min(left, right)}px`;
                el.style.width = `${Math.max(2, Math.abs(right - left))}px`;
                el.style.top = `${gantt.getTaskTop(task.id) + gantt.getTaskHeight() - 4}px`;
                return el;
            });
        }

        eventIds.push(gantt.attachEvent('onBeforeTaskDrag', (id) => {
            const task = findTask(id);
            const allowed = !shiftPreview.value && !shiftBusy.value && !dateBatchWriteCount
                && !pendingDateWrites.has(String(id)) && canEditTaskDates(task);
            taskDragInProgress = allowed;
            activeTaskDragSnapshot = null;
            if (allowed) {
                pendingInitialViewport = null;
                const chartTask = gantt.getTask(id) || {};
                const startDate = chartTask.start_date || task.startDate;
                const DueDate = chartTask.end_date || task.DueDate;
                if (validDate(new Date(startDate)) && validDate(new Date(DueDate))) {
                    activeTaskDragSnapshot = {
                        id: String(id),
                        original: { start_date: new Date(startDate), end_date: new Date(DueDate) },
                        stored: {
                            ...task,
                            startDate: task.startDate instanceof Date ? new Date(task.startDate) : task.startDate,
                            DueDate: task.DueDate instanceof Date ? new Date(task.DueDate) : task.DueDate,
                        },
                    };
                } else {
                    taskDragInProgress = false;
                    return false;
                }
                viewportRestoreVersion += 1;
            }
            return allowed;
        }));
        eventIds.push(gantt.attachEvent('onTaskDrag', (id, mode, task) => {
            if (taskDragInProgress) ensureTimelineForDraggedTask(task || gantt.getTask(id));
        }));
        eventIds.push(gantt.attachEvent('onAfterTaskDrag', (id, mode) => onTaskDragged(id, mode)));
        eventIds.push(gantt.attachEvent('onGanttScroll', () => scheduleViewportRangeCheck()));
        eventIds.push(gantt.attachEvent('onBeforeLinkAdd', () => !shiftPreview.value && !shiftBusy.value));
        eventIds.push(gantt.attachEvent('onBeforeLinkDelete', () => !shiftPreview.value && !shiftBusy.value));
        eventIds.push(gantt.attachEvent('onAfterLinkAdd', (id, link) => persistLinkAdd(id, link)));
        eventIds.push(gantt.attachEvent('onAfterLinkDelete', (id, link) => persistLinkDelete(link)));
        eventIds.push(gantt.attachEvent('onTaskDblClick', (id) => {
            const task = findTask(id);
            if (task) open(task);
            return false;
        }));

        ready = true;
        renderData();
    } catch (e) {
        console.error('Gantt: init failed', e);
        loadError.value = true;
    }
    loading.value = false;

    // Milestones as read-only diamond markers — best-effort; re-render when they arrive.
    try {
        const pid = props.projectData && props.projectData._id;
        if (pid) {
            const res = await apiRequest('get', `${env.MILESTONE_PROJECT}/${pid}`);
            const list = Array.isArray(res && res.data) ? res.data : ((res && res.data && Array.isArray(res.data.data)) ? res.data.data : []);
            milestones.value = list
                .map((m) => ({ _id: m._id, milestoneName: m.milestoneName, date: [m.dueDate, m.endDate, m.startDate].find((d) => d && d !== 0) }))
                .filter((m) => m.date);
            renderData();
        }
    } catch (e) { /* milestones optional */ }
});

async function loadProposals() {
    try {
        const res = await apiRequest('get', `${env.AGENT_PROPOSALS}?status=pending`);
        const rows = res?.data?.status ? (res.data.data || []) : [];
        const pid = String(props.projectData?._id || '');
        proposals.value = rows.filter((p) => !pid || String(p.projectId || '') === pid).slice(0, 2);
    } catch (e) {
        proposals.value = [];
    }
}

watch(signature, () => { if (ready && !suppress) renderData(); });
watch(criticalIds, () => { if (ready && !suppress) renderData(); });
watch(workingDays, () => {
    if (!ready || !gantt) return;
    const anchor = captureViewportAnchor();
    gantt.render();
    restoreViewport(anchor);
});

watch(readOnly, (ro) => {
    if (!ready || !gantt) return;
    if (ro) shiftPreview.value = null;
    const anchor = captureViewportAnchor();
    gantt.config.readonly = ro;
    gantt.config.drag_move = !ro;
    gantt.config.drag_resize = !ro;
    gantt.config.drag_links = !ro;
    gantt.render();
    restoreViewport(anchor);
});

// Sprints can arrive after mount on a fresh reload — trigger the load once they're present.
watch(() => props.sprints, () => ensureTasksLoaded(), { deep: true });

onBeforeUnmount(() => {
    detachTimelinePanGuard();
    try {
        if (gantt) {
            eventIds.forEach((id) => gantt.detachEvent(id));
            if (baselineLayer && typeof gantt.removeTaskLayer === 'function') gantt.removeTaskLayer(baselineLayer);
            if (todayMarker && typeof gantt.deleteMarker === 'function') gantt.deleteMarker(todayMarker);
            gantt.clearAll();
            // Intentionally NOT calling gantt.destructor() — destructing the shared
            // singleton breaks re-init when the Gantt tab is reopened (tasksStore undefined).
        }
    } catch (e) { /* ignore */ }
    eventIds = [];
    baselineLayer = null;
    todayMarker = null;
    gantt = null;
    ready = false;
    timelineRange = { startDate: null, endDate: null };
    pendingInitialViewport = null;
    taskDragInProgress = false;
    activeTaskDragSnapshot = null;
    viewportRestoreVersion += 1;
    renderDeferred = false;
    pendingDateWrites.clear();
    dateBatchWriteCount = 0;
});
</script>

<style scoped src="./style.css"></style>
