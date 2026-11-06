<template>
    <div v-if="!currentCompany?.planFeature?.boardView">
        <UpgradePlan
            :buttonText="$t('Upgrades.upgrade_your_plan')"
            :lastTitle="$t('conformationmsg.unlock_board_view')"
            :secondTitle="$t('Upgrades.unlimited')"
            :firstTitle="$t('Upgrades.upgrade_to')"
            :message="$t('Upgrades.the_feature_not_available')"
        />
    </div>
    <div v-else class="board-view" :data-density="density">
        <template v-if="isLoading">
            <div class="kanban-board-skeleton">
                <div class="kanban-column-skeleton" v-for="j in skeletonColumns" :key="j">
                    <div class="kanban-column-skeleton__head">
                        <Skelaton class="kanban-skel kanban-skel--count" />
                        <Skelaton class="kanban-skel kanban-skel--add" />
                    </div>
                    <div class="kanban-column-skeleton__cards">
                        <div class="kanban-card-skeleton" v-for="i in SKELETON_CARDS" :key="i">
                            <Skelaton class="kanban-skel kanban-skel--title" />
                            <div class="kanban-card-skeleton__foot">
                                <Skelaton class="kanban-skel kanban-skel--avatar" />
                                <div class="kanban-card-skeleton__chips">
                                    <Skelaton class="kanban-skel kanban-skel--chip" />
                                    <Skelaton class="kanban-skel kanban-skel--chip" />
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </template>
        <template v-else>
            <div v-if="boardLoadFailures.length" class="board-load-failure" role="status">
                <span>{{ $t('Everything.group_failed') }}</span>
                <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" :disabled="isRetryingBoardGroups" @click="retryFailedBoardGroups">
                    {{ $t('Everything.retry') }}
                </button>
            </div>
            <template v-if="processedBoardData.length && boardLists.length">
                <ListBulkBar v-if="projectData?._id" :project="projectData" />
                <div class="board-card-fields">
                    <ListSortControl :sort="boardSort.sort.value" :options="sortOptions" :dragNote="false" @key="boardSort.setKey" @dir="boardSort.setDir" />
                    <ViewColumnChooser
                        titleKey="ViewColumns.card_fields"
                        :columns="cardFields.columns.value"
                        @toggle="cardFields.setVisible"
                        @move="cardFields.move"
                        @reset="cardFields.reset"
                    />
                    <ViewDensityControl :model-value="density" @update:model-value="setDensity" />
                </div>
                <KanbanBoard
                    :data="processedBoardData"
                    :group="grouped"
                    :sprintId="sprintId"
                    :aggregateMode="aggregateMode"
                    :boardLists="boardLists"
                    :loadBoardGroupPages="loadBoardGroupPages"
                    :otherRows="otherOnBoard"
                    :otherProjects="otherRows.projects.value"
                    :otherTruncated="otherRowsShown && otherRows.truncated.value"
                />
            </template>
            <template v-else>
                <div class="board-view__empty">
                    <BoardViewTaskCreate
                        v-if="creatingFirstTask && aggregateMode && emptyCreateGroup && boardLists.length"
                        :data="emptyCreateGroup"
                        :sprintId="defaultBoardListId"
                        :allowedSprintIds="boardListIds"
                        :groupValue="grouped"
                        @toggle="creatingFirstTask = false"
                    />
                    <CreateTask
                        v-else-if="creatingFirstTask && !aggregateMode"
                        :sprint="sprints[0]"
                        :assigneeOptions="project?.AssigneeUserId"
                        :groupBy="grouped"
                        :considerWidth="false"
                        @cancel="creatingFirstTask = false"
                        @submit="creatingFirstTask = false"
                    />
                    <EmptyState
                        v-else-if="project?.deletedStatusKey !== 2"
                        :title="$t(emptyTitleKey)"
                        :message="$t(emptyMessageKey)"
                        :actionLabel="canCreateFirstTask ? $t('EmptyState.no_tasks_action') : ''"
                        data-test="board-empty"
                        @action="creatingFirstTask = true"
                        :sentence="emptySentenceKey ? $t(emptySentenceKey) : ''"
                        helpPath="tasks"
                    />
                </div>
            </template>
        </template>
    </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch, inject, provide, defineProps, defineEmits, getCurrentInstance } from 'vue';
import { useStore } from 'vuex';
import EmptyState from '@/components/atom/EmptyState/EmptyState.vue';
import CreateTask from '@/components/atom/CreateTask/CreateTask.vue';
import { useCustomComposable } from '@/composable';
import { markFirstRunStep, FIRST_RUN_STEPS } from '@/composable/firstRunProgress';

// Components
import KanbanBoard from '@/views/Projects/Kanban/KanbanBoard.vue';
import BoardViewTaskCreate from '@/views/Projects/Kanban/BoardViewTaskCreate.vue';
import ListBulkBar from '@/views/Projects/ListView/ListBulkBar.vue';
import { taskInGroup } from '@/views/Projects/ListView/listFilter';
import { inList } from '@/store/ProjectData/listMembership';
import { placeOnBoard, useOtherProjectRows } from '@/views/Projects/composables/otherProjectRows';
import UpgradePlan from '@/components/atom/UpgradYourPlanComponent/UpgradYourPlanComponent.vue';
import Skelaton from '@/components/atom/Skelaton/Skelaton.vue';
import ViewColumnChooser from '@/views/Projects/components/columns/ViewColumnChooser.vue';
import ViewDensityControl from '@/views/Projects/components/columns/ViewDensityControl.vue';
import { useViewSettings } from '@/views/Projects/composables/viewSettingsContext';
import { columnCatalogue, useViewColumns } from '@/views/Projects/composables/viewColumns';
import ListSortControl from '@/views/Projects/ListView/ListSortControl.vue';
import { sortChoices, sortTasks, useListSort } from '@/views/Projects/composables/viewSort';
import { useProjectCustomFields } from '@/views/Projects/composables/projectCustomFields';
import { useListRowMenu } from '@/views/Projects/ListView/useListRowMenu.js';
import { useListInlineEdit } from '@/views/Projects/ListView/useListInlineEdit.js';
import { useGroupSource } from '@/views/Projects/composables/groupSource';
import { AGENT_WORK_GROUP } from '@viewSettings';
import { drawsGroup } from '@/views/Projects/composables/agentWorkQuery';

// Helpers
import { taskListHelper } from '@/views/Projects/helper.js';
import { useTaskEmptyState } from '@/views/Projects/composables/useTaskEmptyState.js';
import { useRoute } from 'vue-router';
const route = useRoute();

// --- Props & Emits ---
const props = defineProps({
    grouped: { type: [Number, String], default: 0 },
    commonDateFormatForDate: { type: String, default: "DD/MM/YYYY" },
    sprints: { type: Array, default: () => [] },
    projectData: { type: Object, default: () => ({}) },
});

defineEmits(['change']);

// --- Store & Injected State ---
const { getters, dispatch } = useStore();
const { groupBy, getGroupCounts, getBoardGroupPages } = taskListHelper();
const showArchiveVar = inject("showArchived");
const searchedTask = inject('searchedTask');
const project = inject('selectedProject');
const userId = inject('$userId', ref(''));
const { emptyTitleKey, emptyMessageKey, emptySentenceKey } = useTaskEmptyState(project);
const { checkPermission } = useCustomComposable();
const creatingFirstTask = ref(false);

const customFields = useProjectCustomFields(project, { archived: showArchiveVar });
const cardCatalogue = computed(() => columnCatalogue('board', { fields: customFields.defs.value }));
const cardFields = useViewColumns(computed(() => project.value?._id), 'board', cardCatalogue);
provide('boardCardFields', cardFields.visibleColumns);
provide('boardFieldTasks', customFields.allTasks);

/* The card menu's rights and the two actions it borrows from the List, built once for the
   board rather than once per card. */
const rowMenu = useListRowMenu(project, showArchiveVar);
provide('boardTaskMenu', { rights: rowMenu.rights, duplicate: rowMenu.duplicate, removeFromList: rowMenu.removeFromList, rename: useListInlineEdit(project).rename });

const boardSort = useListSort();
const { density, setDensity } = useViewSettings();
const sortOptions = computed(() => sortChoices(customFields.defs.value));
const userNames = computed(() => new Map((getters['users/users'] || []).map((user) => [user._id, user.Employee_Name])));
const sortContext = computed(() => ({
    priorities: getters['settings/companyPriority'] || [],
    statuses: project.value?.taskStatusData || [],
    fields: customFields.defs.value,
    userName: (id) => userNames.value.get(id)
}));

// --- Reactive State ---
const isLoading = ref(true);
const internalGroupedTasks = ref([]);
const sprintId = ref(null);
const boardLoadFailures = ref([]);
const isRetryingBoardGroups = ref(false);
const boardLoadRun = ref(0);
const BOARD_COUNT_SETTLE_MS = 400;
let boardGroupCountTimer = null;
const aggregateMode = computed(() => !route.params.sprintId);
const boardLists = computed(() => (props.sprints || [])
    .flatMap((sprint) => sprint?.archivedSprintList ? Object.values(sprint.archivedSprintList) : [sprint])
    .filter((sprint) => sprint && !sprint.isFolder && !sprint.isFolderSprint && !sprint.sprintsObj && !sprint.archivedSprintList)
    .map((sprint) => {
        const id = String(sprint.id || sprint._id || '');
        return id ? { ...sprint, id, boardListId: id, boardListName: sprint.name || '' } : null;
    })
    .filter(Boolean)
    .filter((list, index, all) => all.findIndex((candidate) => candidate.id === list.id) === index));
const boardListIds = computed(() => boardLists.value.map((list) => list.id));
const boardListOrder = computed(() => new Map(boardListIds.value.map((id, index) => [id, index])));
const boardScopeKey = computed(() => boardListIds.value.join(','));
const defaultBoardListId = computed(() => boardListIds.value[0] || '');
const boardOwnerKey = `board:${getCurrentInstance()?.uid ?? Math.random().toString(36).slice(2)}`;
const showAllTasks = computed(() => project.value?.isGlobalPermission === false
    ? checkPermission('task.show_tasks', project.value?.isGlobalPermission)
    : true);

// --- Computed Properties ---
const currentCompany = computed(() => getters["settings/selectedCompany"]);
const allProjectTasks = computed(() => getters["projectData/tasks"] || {});
const searchedTasksData = computed(() => getters['projectData/searchedTasks'] || []);
const boardCountsStaleSignature = computed(() => {
    const pid = String(project.value?._id || '');
    return boardLists.value.map((list) => `${list.id}:${Number(allProjectTasks.value[pid]?.[list.id]?.countsStale) || 0}`).join('|');
});
const listIdOf = (sprint) => String(sprint?.id || sprint?._id || '');
const groupSignature = (group) => JSON.stringify([
    group?.searchKey,
    group?.searchValue,
    group?.customFieldId || '',
    Boolean(group?.agentWork),
    Boolean(group?.noAgent)
]);

const boardGroupDefinitions = computed(() => {
    const groups = new Map();
    (internalGroupedTasks.value || []).forEach((sprint) => {
        const id = listIdOf(sprint);
        const list = boardLists.value.find((item) => item.id === id);
        (sprint?.items || []).forEach((item) => {
            const signature = groupSignature(item);
            if (!groups.has(signature)) {
                groups.set(signature, { ...item, boardListItems: [] });
            }
            groups.get(signature).boardListItems.push({
                sprintId: id,
                boardListId: id,
                boardListName: list?.name || sprint?.name || '',
                item
            });
        });
    });
    return [...groups.values()];
});

const emptyCreateGroup = computed(() => boardGroupDefinitions.value[0] || internalGroupedTasks.value[0]?.items?.[0] || null);
const canCreateFirstTask = computed(() => Boolean(boardLists.value.length)
    && !showArchiveVar.value
    && !searchedTask.value
    && (!aggregateMode.value || Boolean(emptyCreateGroup.value))
    && checkPermission('task.task_create', project.value?.isGlobalPermission) === true
    && checkPermission('task.task_list', project.value?.isGlobalPermission) === true);

const boardSubscriptionKey = computed(() => [
    String(project.value?._id || ''),
    aggregateMode.value ? 'aggregate' : 'list',
    boardListIds.value.join(','),
    String(props.grouped),
    String(showAllTasks.value),
    String(userId.value || ''),
    JSON.stringify(boardGroupDefinitions.value.map((group) => groupSignature(group)))
].join(':'));

// A skeleton that redraws at a different size on every load reads as movement
// rather than as the shape of what is coming.
const SKELETON_CARDS = 3;
const skeletonColumns = computed(() => {
    const groups = boardGroupDefinitions.value.length
        || (props.grouped === 0 ? project.value?.taskStatusData?.length : 0);
    return Math.min(Math.max(Number(groups) || 3, 2), 5);
});

function taskSourceRows() {
    const listScope = boardLists.value;
    if (!listScope.length || !project.value?._id) return [];

    if (searchedTask.value) {
        if (!searchedTasksData.value.length) return [];
        const occurrences = [];
        const seen = new Set();
        searchedTasksData.value.forEach((task) => {
            listScope.forEach((list) => {
                if (!inList(task, list.id)) return;
                const key = `${task._id}:${list.id}`;
                if (seen.has(key)) return;
                seen.add(key);
                occurrences.push(aggregateMode.value
                    ? { ...task, boardListId: list.id, boardListName: list.name, boardMembershipKey: key }
                    : task);
            });
        });
        return occurrences;
    }

    if (aggregateMode.value) {
        const occurrences = [];
        const seen = new Set();
        listScope.forEach((list) => {
            const rows = allProjectTasks.value[project.value._id]?.[list.id]?.tasks || [];
            rows.forEach((task) => {
                if (!inList(task, list.id)) return;
                const key = `${task._id}:${list.id}`;
                if (seen.has(key)) return;
                seen.add(key);
                occurrences.push({ ...task, boardListId: list.id, boardListName: list.name, boardMembershipKey: key });
            });
        });
        return occurrences;
    }

    const currentList = listScope[0];
    return allProjectTasks.value[project.value._id]?.[currentList.id]?.tasks || [];
}

// Determine the source task array based on whether a search is active
const taskSourceArray = computed(taskSourceRows);

function sortGroupRows(rows, indexName) {
    if (!aggregateMode.value) {
        return rows.sort((a, b) => a[indexName] - b[indexName]);
    }
    rows.sort((a, b) => {
        const listDelta = (boardListOrder.value.get(String(a?.boardListId || '')) ?? Number.MAX_SAFE_INTEGER)
            - (boardListOrder.value.get(String(b?.boardListId || '')) ?? Number.MAX_SAFE_INTEGER);
        if (listDelta) return listDelta;
        return Number(a?.[indexName] ?? 0) - Number(b?.[indexName] ?? 0);
    });
    return rows;
}

// The core logic: Computed property that processes tasks based on grouping
const processedBoardData = computed(() => {

    if (!boardGroupDefinitions.value.length || !taskSourceArray.value) {
        return [];
    }

    const groupDefinitions = boardGroupDefinitions.value;
    const sourceTasks = taskSourceArray.value;
    const filteredSourceTasks = sourceTasks.filter(task => (showArchiveVar.value ? task?.deletedStatusKey : !task?.deletedStatusKey));

    return groupDefinitions.map(group => {
        let tasksForGroup = [];

        switch (group.searchKey) {
            case "DueDate":
                tasksForGroup = filteredSourceTasks.filter(task => taskInGroup(task, group));
                sortGroupRows(tasksForGroup, 'groupByDueDateIndex');
                break;
            case "AssigneeUserId":
                tasksForGroup = filteredSourceTasks.filter(task => taskInGroup(task, group));
                sortGroupRows(tasksForGroup, 'groupByAssigneeIndex');
                break;
            case "statusKey":
                tasksForGroup = filteredSourceTasks.filter(task => task.statusKey === group.searchValue);
                sortGroupRows(tasksForGroup, 'groupByStatusIndex');
                break;
            case "Task_Priority":
                tasksForGroup = filteredSourceTasks.filter(task => task.Task_Priority === group.searchValue);
                sortGroupRows(tasksForGroup, 'groupByPriorityIndex');
                break;
            default:
                tasksForGroup = filteredSourceTasks.filter(task => (group.customFieldId || group.agentWork ? taskInGroup(task, group) : task[group.searchKey] === group.searchValue));
                break;
        }
        tasksForGroup = sortTasks(tasksForGroup, boardSort.sort.value, sortContext.value);
        // Aggregate Board order is stable by route List, then by page order inside that List.
        if (aggregateMode.value) sortGroupRows(tasksForGroup, group.indexName || 'groupByStatusIndex');

        // If subtasks don't need filtering here, remove this map.
        const processedTasks = tasksForGroup.map(task => {
            if (task?.subtaskArray) {
                return {
                    ...task,
                    subtaskArray: task.subtaskArray.filter(sub => !sub?.deletedStatusKey)
                };
            }
            return task;
        });

        const currentSprintId = defaultBoardListId.value;
        sprintId.value = currentSprintId;
        const countKey = `${group.searchKey}_${group.searchValue}`;
        const dataKeys = aggregateMode.value
            ? Object.fromEntries([[countKey, group.boardListItems.reduce((total, source) => {
                const found = allProjectTasks.value[project.value._id]?.[source.sprintId]?.found?.[countKey];
                return total + (Number.isFinite(Number(found)) ? Number(found) : 0);
            }, 0)]])
            : allProjectTasks.value[project.value._id]?.[currentSprintId]?.found || {};

        return {
            ...group,
            sprintId: aggregateMode.value ? undefined : currentSprintId,
            tasksArray: processedTasks,
            disabled: group.dropDisabled || (group.searchKey === "DueDate" && ["Next", "Overdue", "No Due Date"].includes(group.name)),
            totalTaskCounts: dataKeys || {},
        };
    }).filter((column) => drawsGroup(column, column.tasksArray.length));
});

/* A search or a filter is matched against this project's own data, which says nothing of a task that lives elsewhere. */
const otherRows = useOtherProjectRows(project, boardLists);
const otherRowsShown = computed(() => !searchedTask.value && !showArchiveVar.value);
const otherOnBoard = computed(() => placeOnBoard(otherRowsShown.value ? otherRows.rows.value : [], processedBoardData.value));

const boardGroupBy = computed(() => ({
    type: props.grouped,
    items: boardGroupDefinitions.value.map((item) => ({
        key: `${item.searchKey}_${item.searchValue}`,
        value: item.searchValue,
        name: item.matchName || item.name
    }))
}));

const subscriptionLists = computed(() => boardLists.value.map((list) => list.id));
let subscribedBoardKey = '';
let boardSubscriptionRevision = 0;
let boardViewUnmounted = false;
function updateBoardSubscription(force = false) {
    if (!aggregateMode.value || !project.value?._id || !subscriptionLists.value.length || !boardGroupDefinitions.value.length) {
        if (subscribedBoardKey) {
            boardSubscriptionRevision += 1;
            dispatch('projectData/unsubscribeBoardTaskRooms', { ownerKey: boardOwnerKey }).catch(() => {});
            subscribedBoardKey = '';
        }
        return;
    }
    if (!force && subscribedBoardKey === boardSubscriptionKey.value) return;
    const nextKey = boardSubscriptionKey.value;
    const revision = ++boardSubscriptionRevision;
    subscribedBoardKey = nextKey;
    dispatch('projectData/subscribeBoardTaskRooms', {
        ownerKey: boardOwnerKey,
        pid: project.value._id,
        listIds: subscriptionLists.value,
        userId: userId.value,
        showAllTasks: showAllTasks.value,
        groupBy: boardGroupBy.value,
        currentView: 'tasks'
    }).then(() => {
        if (boardViewUnmounted || revision !== boardSubscriptionRevision || subscribedBoardKey !== nextKey) {
            if (boardViewUnmounted || !aggregateMode.value) {
                dispatch('projectData/unsubscribeBoardTaskRooms', { ownerKey: boardOwnerKey }).catch(() => {});
            } else {
                updateBoardSubscription(true);
            }
        }
    }).catch((error) => {
        if (subscribedBoardKey === nextKey) subscribedBoardKey = '';
        console.error('ERROR in board task subscription: ', error);
    });
}

async function loadBoardGroupPages(boardListItems, { firstPageOnly = false } = {}) {
    const sources = Array.isArray(boardListItems) ? boardListItems : [];
    const bucketsByList = new Map();
    sources.forEach((source) => {
        const sprintId = String(source?.sprintId || source?.boardListId || '');
        if (!sprintId || !source?.item) return;
        if (!bucketsByList.has(sprintId)) bucketsByList.set(sprintId, []);
        bucketsByList.get(sprintId).push(source.item);
    });
    if (!bucketsByList.size || !project.value?._id) return { failed: [] };
    const requestProjectId = String(project.value._id);
    const requestScope = boardScopeKey.value;
    const result = await getBoardGroupPages({
        projectId: requestProjectId,
        projectData: project.value,
        buckets: [...bucketsByList].map(([sprintId, items]) => ({ sprintId, items })),
        firstPageOnly,
        fetchNew: true
    });
    if (requestProjectId !== String(project.value?._id || '') || requestScope !== boardScopeKey.value) return result;
    if (result?.failed?.length) {
        const merged = new Map();
        [...boardLoadFailures.value, ...result.failed].forEach((failure) => {
            const key = `${failure.sprintId}:${(failure.groupKeys || []).join(',')}`;
            merged.set(key, failure);
        });
        boardLoadFailures.value = [...merged.values()];
    }
    return result;
}

function hasStaleBoardGroupCounts() {
    const pid = String(project.value?._id || '');
    return boardLists.value.some((list) => Number(allProjectTasks.value[pid]?.[list.id]?.countsStale) > 0);
}

function refreshBoardGroupCounts() {
    const currentProject = project.value;
    if (!aggregateMode.value || !currentProject?._id || !internalGroupedTasks.value.length) return Promise.resolve();
    const projectId = String(currentProject._id);
    return Promise.allSettled(internalGroupedTasks.value.map((sprint) => getGroupCounts({
        projectId,
        sprintId: listIdOf(sprint),
        items: sprint.items || [],
        projectData: currentProject
    })));
}

function scheduleBoardGroupCountRefresh() {
    const projectId = String(project.value?._id || '');
    const scope = boardScopeKey.value;
    clearTimeout(boardGroupCountTimer);
    boardGroupCountTimer = setTimeout(() => {
        boardGroupCountTimer = null;
        if (boardViewUnmounted || projectId !== String(project.value?._id || '') || scope !== boardScopeKey.value) return;
        refreshBoardGroupCounts();
    }, BOARD_COUNT_SETTLE_MS);
}

async function retryFailedBoardGroups() {
    if (isRetryingBoardGroups.value || !boardLoadFailures.value.length) return;
    const failed = boardLoadFailures.value;
    const requestProjectId = String(project.value?._id || '');
    const requestScope = boardScopeKey.value;
    const bucketsByList = new Map();
    failed.forEach((failure) => {
        const list = internalGroupedTasks.value.find((sprint) => listIdOf(sprint) === String(failure.sprintId));
        const groupKeys = new Set(failure.groupKeys || []);
        const items = (list?.items || []).filter((item) => {
            const foundKey = `${item.searchKey}_${item.searchValue}`;
            return !groupKeys.size || groupKeys.has(foundKey) || groupKeys.has(item.key);
        });
        const sprintId = String(failure.sprintId);
        if (!bucketsByList.has(sprintId)) bucketsByList.set(sprintId, new Map());
        items.forEach((item) => bucketsByList.get(sprintId).set(`${item.searchKey}_${item.searchValue}`, item));
    });
    const buckets = [...bucketsByList].map(([sprintId, items]) => ({ sprintId, items: [...items.values()] })).filter((bucket) => bucket.items.length);
    if (!buckets.length) return;
    isRetryingBoardGroups.value = true;
    try {
        const result = await getBoardGroupPages({
            projectId: requestProjectId,
            projectData: project.value,
            buckets,
            firstPageOnly: false,
            fetchNew: true
        });
        if (requestProjectId === String(project.value?._id || '') && requestScope === boardScopeKey.value) {
            boardLoadFailures.value = result?.failed || [];
        }
    } catch (error) {
        console.error('ERROR retrying board task groups: ', error);
    } finally {
        isRetryingBoardGroups.value = false;
    }
}

async function loadBoard({ showLoading = false } = {}) {
    const run = ++boardLoadRun.value;
    if (showLoading) isLoading.value = true;
    if (!project.value?._id || !boardLists.value.length) {
        internalGroupedTasks.value = [];
        boardLoadFailures.value = [];
        updateBoardSubscription();
        isLoading.value = false;
        return;
    }
    const loadSprints = aggregateMode.value ? boardLists.value : boardLists.value.slice(0, 1);
    try {
        await groupBy(props.grouped, true, project.value, loadSprints, internalGroupedTasks, true, 'board', false, true, (response, result = { failed: [] }) => {
            if (run !== boardLoadRun.value) return;
            internalGroupedTasks.value = response;
            boardLoadFailures.value = result?.failed || [];
            sprintId.value = defaultBoardListId.value || null;
            updateBoardSubscription();
            if (aggregateMode.value && hasStaleBoardGroupCounts()) scheduleBoardGroupCountRefresh();
        }, { firstPageOnly: true, allSprints: aggregateMode.value });
        if (run === boardLoadRun.value && props.grouped === AGENT_WORK_GROUP) {
            await Promise.allSettled(internalGroupedTasks.value.map((sprint) => getGroupCounts({
                projectId: project.value._id,
                sprintId: listIdOf(sprint),
                items: sprint.items || [],
                projectData: project.value
            })));
        }
    } catch (error) {
        if (run === boardLoadRun.value) console.error('Error during board group load:', error);
    } finally {
        if (run === boardLoadRun.value && showLoading) {
            setTimeout(() => { if (run === boardLoadRun.value) isLoading.value = false; }, 500);
        } else if (run === boardLoadRun.value) {
            isLoading.value = false;
        }
    }
}

// Watch for changes in grouping type or sprints to regenerate the group structure
watch([() => props.grouped, boardScopeKey, () => `${route.name}:${route.params.id || ''}:${route.params.folderId || ''}:${route.params.sprintId || ''}`, () => project.value?._id], (next, previous) => {
    const changed = !previous || next.some((value, index) => value !== previous[index]);
    if (changed && project.value?._id) loadBoard({ showLoading: true });
});

watch(aggregateMode, (isAggregate) => {
    if (!isAggregate) updateBoardSubscription();
});

watch([showAllTasks, userId], () => updateBoardSubscription());

watch([() => String(project.value?._id || ''), boardScopeKey, boardCountsStaleSignature], (next, previous) => {
    if (!previous || !aggregateMode.value || next[0] !== previous[0] || next[1] !== previous[1] || next[2] === previous[2]) return;
    scheduleBoardGroupCountRefresh();
});

/* Columns the board already read answer at once (`firstPageOnly`), so only a new one is asked for, and the board stays drawn. */
useGroupSource(project, () => props.grouped, () => {
    if (!props.sprints?.length) return;
    loadBoard();
});

onMounted(async () => {
    markFirstRunStep(FIRST_RUN_STEPS.BOARD_VIEW);
    await loadBoard({ showLoading: true });
});

onBeforeUnmount(() => {
    boardViewUnmounted = true;
    clearTimeout(boardGroupCountTimer);
    boardLoadRun.value += 1;
    boardSubscriptionRevision += 1;
    dispatch('projectData/unsubscribeBoardTaskRooms', { ownerKey: boardOwnerKey }).catch(() => {});
});

</script>
<style src="./new-style.css" />

<style>
.board-card-fields { display: flex; justify-content: flex-end; align-items: center; gap: var(--sp-3); padding: var(--sp-2) var(--page-pad-x, 20px) 0; }
.board-load-failure { display: flex; align-items: center; justify-content: space-between; gap: var(--sp-3); margin: var(--sp-2) var(--page-pad-x, 20px) 0; padding: var(--sp-2) var(--sp-3); border: 1px solid var(--border); border-radius: var(--r-sm, 6px); color: var(--ink-2); font-size: var(--fs-sm, 12px); }
@media (max-width: 767px) { .board-card-fields { padding: var(--sp-2) 16px 0; } }
</style>
