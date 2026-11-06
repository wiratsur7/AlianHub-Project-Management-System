import { computed, onBeforeUnmount, ref, unref, watch } from "vue";
import { useStore } from "vuex";
import { apiRequest } from "@/services";
import * as env from "@/config/env";
import { taskInGroup } from "@/views/Projects/ListView/listFilter";

/* The tasks added to a list from other projects. The page loaded one project, so these rows are
 * not in its store: they come from the Everything read, which sends each row only to a person who
 * can open its home, with that project's card (statuses, apps, edit rights) beside it. */

export const MAX_PROJECTS = 500;
export const MAX_LIST_IDS_PER_REQUEST = 100;
const PAGE_SIZE = 100;
const MAX_PAGES = 3;
const MAX_CONCURRENT_BATCHES = 4;
const REFRESH_MS = 600;

const same = (a, b) => String(a ?? "") === String(b ?? "");

export function otherProjectIds(projects, projectId) {
    return [...new Set((projects || [])
        .filter((project) => project?._id && !project.deletedStatusKey && !same(project._id, projectId))
        .map((project) => String(project._id)))]
        .slice(0, MAX_PROJECTS);
}

export function otherRowsRequest(listIds, projectIds, cursor = null) {
    const ids = [...new Set((Array.isArray(listIds) ? listIds : [listIds]).filter(Boolean).map(String))]
        .slice(0, MAX_LIST_IDS_PER_REQUEST);
    return { filter: { sprintIds: ids, projectIds }, limit: PAGE_SIZE, ...(cursor ? { cursor } : {}) };
}

export function keepOtherRows(rows, cards, projectId) {
    return (rows || []).filter((row) => !same(row.ProjectID, projectId) && Boolean(cards?.[String(row.ProjectID)]));
}

/* Nothing this page loaded can judge an edit in the row's own project, so the row is drawn with
 * no edit right; the task panel loads that project and is where the task is changed. */
export const readOnlyCard = (card) => (card ? { ...card, edit: { status: false, priority: false } } : null);

/* A status belongs to its project, so a card sits under the column named like its own status
 * whatever the key is here. Under another grouping the value means the same in every project. */
export function columnFor(row, columns) {
    return (columns || []).find((column) => {
        if (column.customFieldId) return false;
        if (column.searchKey === "statusKey") return Boolean(column.name) && column.name === row.status?.text;
        return taskInGroup(row, column);
    }) || null;
}

export function placeOnBoard(rows, columns) {
    const placed = {};
    const unplaced = [];
    (rows || []).forEach((row) => {
        const column = columnFor(row, columns);
        if (!column) unplaced.push(row);
        else (placed[column.key] = placed[column.key] || []).push(row);
    });
    return { placed, unplaced };
}

function listScopesOf(value, projectId) {
    const input = unref(value);
    const entries = Array.isArray(input) ? input : (input ? [input] : []);
    const scopes = new Map();
    entries.forEach((entry) => {
        const sprintId = typeof entry === "string" || typeof entry === "number"
            ? String(entry)
            : String(entry?.sprintId || entry?.id || entry?._id || "");
        if (!sprintId) return;
        scopes.set(sprintId, {
            projectId: String(entry?.projectId || projectId || ""),
            sprintId,
            name: String(entry?.name || ""),
        });
    });
    return [...scopes.values()];
}

function batchesOf(values, size) {
    const batches = [];
    for (let index = 0; index < values.length; index += size) batches.push(values.slice(index, index + size));
    return batches;
}

function rowsForMemberships(rows, cards, projectId, scopes) {
    const visible = new Map(scopes.map((scope) => [scope.sprintId, scope]));
    const expanded = new Map();
    keepOtherRows(rows, cards, projectId).forEach((row) => {
        const destinations = new Map();
        (Array.isArray(row.extraLists) ? row.extraLists : []).forEach((entry) => {
            const boardListId = String(entry?.sprintId || "");
            if (same(entry?.projectId, projectId) && visible.has(boardListId)) destinations.set(boardListId, entry);
        });
        destinations.forEach((entry, boardListId) => {
            const scope = visible.get(boardListId);
            const boardListKey = `${boardListId}::${String(row._id)}`;
            expanded.set(boardListKey, {
                ...row,
                membershipSprintId: boardListId,
                boardListId,
                boardProjectId: scope.projectId || String(projectId),
                boardListName: scope.name || String(entry.name || ""),
                boardListCount: scopes.length,
                boardListKey,
                boardRowKey: boardListKey,
            });
        });
    });
    return [...expanded.values()];
}

export function useOtherProjectRows(project, listId) {
    const store = useStore();
    const rows = ref([]);
    const projects = ref({});
    const truncated = ref(false);
    let serial = 0;
    let timer = null;

    const projectId = computed(() => String(unref(project)?._id || ""));
    const lists = computed(() => listScopesOf(listId, projectId.value));
    const listSignature = computed(() => JSON.stringify(lists.value.map(({ projectId, sprintId, name }) => [projectId, sprintId, name])));
    const others = computed(() => otherProjectIds(store.getters["projectData/onlyActiveProjects"]?.data, projectId.value));

    function show(found, cards, more, scopes = lists.value) {
        rows.value = rowsForMemberships(found, cards, projectId.value, scopes);
        projects.value = cards;
        truncated.value = more;
    }

    async function load() {
        const mine = ++serial;
        const scopes = lists.value;
        if (!projectId.value || !scopes.length || !others.value.length) {
            show([], {}, false);
            return;
        }
        const batches = batchesOf(scopes, MAX_LIST_IDS_PER_REQUEST);
        const results = new Array(batches.length);
        let nextBatch = 0;
        const loadBatch = async () => {
            while (mine === serial) {
                const batchIndex = nextBatch;
                nextBatch += 1;
                if (batchIndex >= batches.length) return;
                const batch = batches[batchIndex];
                const result = { rows: [], projects: {}, more: false };
                let cursor = null;
                for (let page = 0; page < MAX_PAGES; page += 1) {
                    try {
                        const data = (await apiRequest("post", env.V2_TASKS_EVERYTHING, otherRowsRequest(batch.map((scope) => scope.sprintId), others.value, cursor)))?.data?.data;
                        if (mine !== serial) return;
                        result.rows.push(...(data?.rows || []));
                        result.projects = { ...result.projects, ...(data?.projects || {}) };
                        cursor = data?.nextCursor || null;
                        if (!cursor) break;
                        if (page === MAX_PAGES - 1) result.more = true;
                    } catch (_error) {
                        if (mine !== serial) return;
                        break;
                    }
                }
                results[batchIndex] = result;
            }
        };
        await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENT_BATCHES, batches.length) }, loadBatch));
        if (mine !== serial) return;
        const found = results.flatMap((result) => result?.rows || []);
        const cards = Object.assign({}, ...results.map((result) => result?.projects || {}));
        const more = results.some((result) => result?.more === true);
        if (mine === serial) show(found, cards, more, scopes);
    }

    function reloadSoon() {
        clearTimeout(timer);
        timer = setTimeout(load, REFRESH_MS);
    }

    watch([projectId, listSignature, () => others.value.join()], load, { immediate: true });
    watch(() => store.getters["projectData/otherProjectChanges"] || 0, (now, before) => { if (now > before) reloadSoon(); });
    onBeforeUnmount(() => {
        clearTimeout(timer);
        serial += 1;
    });

    return { rows, projects, truncated };
}
