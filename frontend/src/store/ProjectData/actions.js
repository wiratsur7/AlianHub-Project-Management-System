import * as env from '@/config/env';
import { apiRequest } from '../../services/index'
import { tableSortStages } from '@/views/Projects/composables/customFieldQuery';
import { pagedPast, taskInGroup } from '@/views/Projects/ListView/listFilter';
import { groupCondition, groupCountsQuery, readGroupCounts, readGroupTotals, sprintTaskMatch } from './taskQueries';
import {
    boardGroupPageBatches,
    boardGroupPageFlightKey,
    boardGroupFoundKey,
    boardGroupIndexKey,
    buildBoardGroupPageQuery,
    coalesceBoardGroupPageFlight,
    readBoardGroupPageBatch,
} from './boardTaskQueries';
import { ensureTaskSocketManager, joinTaskListRooms, leaveTaskListRooms } from './taskSocketManager';
import { ancestorsOf } from '@taskTreeRules';
import { homeListOf } from './listMembership';

/* A second caller for a page that is already on its way gets the first one's answer. */
const pagesInFlight = new Map();
const taskSocketScopesByClient = new WeakMap();
/**
 * This function is used to get all the projects from MongoDB and add into the Vuex project store.
 * @param {*} state 
 * @returns 
 */
export const setProjects = (state, payload) => {
    return new Promise((resolve, reject) => {
        try {
            state.state.allProjects = [];
            apiRequest("get", `/api/v1/${env.PROJECTACTIONS}`).then((responseData) => {
                let result = [];
                responseData.data.map(x => {
                    const obj = { roleType: payload.roleType, snap: null, isPrivateSpace: x.isPrivateSpace, op: "added", data: {...x, isExpanded: false}}
                    result.push(obj);
                })
                resolve(result);
                state.commit('mutateProjects', result);
            }).catch((error)=>{
                console.error("Error while getting project",error);
                resolve([]);
            })
        } catch (error) {
            reject(error);
        }
    });
};
const SPRINT_COUNTS_SETTLE_MS = 800;
const sprintCountTimers = new Map();
const COUNTER_FIELDS = ["sprintId", "deletedStatusKey", "extraLists"];

/* A list's own `tasks` counter is kept by the server and no event carries it. After a change that can
   move it (a task created, removed, trashed, archived or moved to another list) the counters are read
   again once the burst of events has passed, whatever number of rooms said so. The server adds a task to
   the counter after it writes the task, so the read waits instead of racing it. */
function queueSprintCounts(dispatch, pid, op, data, updatedFields) {
    const moves = op === "modified" && COUNTER_FIELDS.some((field) => field in (updatedFields || {}));
    if(!pid || !data?._id || (op === "modified" && !moves)) return;
    clearTimeout(sprintCountTimers.get(pid));
    sprintCountTimers.set(pid, setTimeout(() => {
        sprintCountTimers.delete(pid);
        dispatch('refreshSprintCounts', {pid});
    }, SPRINT_COUNTS_SETTLE_MS));
}

export const refreshSprintCounts = ({state, commit}, payload) => {
    const {pid} = payload;
    return apiRequest("get", `/api/v1/${env.GET_SPRINT_OR_PROJECT}/${pid}?collection=sprints`).then((resp) => {
        (resp?.data || []).forEach((sprint) => {
            const held = state.sprints?.[pid]?.find((x) => x._id === sprint._id);
            if(!held || (held.tasks === sprint.tasks && held.archiveTaskCount === sprint.archiveTaskCount)) return;
            commit('mutateSprints', {op: "modified", data: {...held, tasks: sprint.tasks, archiveTaskCount: sprint.archiveTaskCount}});
        });
    }).catch((error) => console.error("ERROR in reading list counters: ", error));
}

function taskSocketRow(eventName, payload) {
    return eventName === 'taskReplace'
        ? (payload?.documentKey || payload?.fullDocument)
        : (payload?.fullDocument || payload?.documentKey);
}

function taskSocketOperation(eventName) {
    if (eventName === 'taskInsert') return 'added';
    if (eventName === 'taskDelete') return 'removed';
    return 'modified';
}

function taskSocketHandler({commit, pid, sprintIds, showAllTasks, userId, membershipScoped = false}) {
    const allowedLists = new Set(sprintIds.map(String));
    return ({membershipSprintId, eventName, payload: eventPayload}) => {
        const sprintId = String(membershipSprintId || '');
        if (!sprintId || !allowedLists.has(sprintId)) return;
        const data = taskSocketRow(eventName, eventPayload);
        if (!data?._id) return;
        if (!(showAllTasks === undefined || showAllTasks === true || showAllTasks === 2)
            && ![].concat(data.AssigneeUserId || []).map(String).includes(String(userId || ''))) return;
        const op = taskSocketOperation(eventName);
        const updatedFields = eventPayload?.updatedFields || (eventName === 'taskInsert' ? data : {});
        commit('mutateUpdateFirebaseTasks', {
            snap: {}, op, pid, sprintId, data: {...data}, updatedFields: {...updatedFields}, showAllTasks, membershipScoped,
        });
        commit('mutateMongoUpdatedTask', {snap: {}, op, pid, sprintId, data: {...data}});
        if (op !== 'removed') commit('mutateTypesenseTasks', {snap: {}, op, pid, sprintId, data: {...data}});
        commit('mutateTypesenseTableTasks', {snap: {}, op, pid, sprintId, data: {...data}});
    };
}

// A move leaves a list this tab holds no room for, so the counters hear every task event of the project.
function sprintCountsListener(dispatch, pid) {
    return (eventName, payload) => {
        const data = taskSocketRow(eventName, payload);
        if (data?.ProjectID && String(data.ProjectID) !== String(pid)) return;
        const updatedFields = payload?.updatedFields || (eventName === 'taskInsert' ? data : {});
        queueSprintCounts(dispatch, pid, taskSocketOperation(eventName), data, updatedFields);
    };
}

export const getTasksFromMongoDB = ({state, commit, rootState, dispatch}, payload = {}) => {
    const {pid, sprintId, userId, showAllTasks, groupBy, currentView = 'tasks'} = payload;
    const socket = rootState.settings.socketInstance;
    if (!socket || typeof socket.on !== 'function' || typeof socket.emit !== 'function') {
        return Promise.reject(new Error('Task socket is not connected'));
    }

    const sprintIds = [...new Set((payload.sprintIds || [sprintId]).filter(Boolean).map(String))];
    if (!pid || !sprintIds.length) return Promise.resolve();

    commit('setTaskSnapShotPayload', payload);
    const projectFound = Object.keys(state[currentView] || {}).includes(pid);
    if (projectFound && groupBy && JSON.stringify(groupBy) !== JSON.stringify(state[currentView]?.[pid]?.groupBy)) {
        state[currentView][pid].groupBy = groupBy;
    }

    const ownerKey = payload.ownerKey || `legacy:${currentView}:${pid}`;
    let ownerScopes = taskSocketScopesByClient.get(socket);
    if (!ownerScopes) {
        ownerScopes = new Map();
        taskSocketScopesByClient.set(socket, ownerScopes);
    }
    const previousScope = ownerScopes.get(ownerKey) || {pid, sprintIds: []};
    const previousSprintIds = previousScope.sprintIds || [];
    previousSprintIds.filter((id) => previousScope.pid !== pid || !sprintIds.includes(id)).forEach((id) => {
        commit('setGetPaginatedTasksPayload', {data: {pid: previousScope.pid, sprintId: id}, op: 'remove'});
        commit('setGetTableTaskPayload', {data: {pid: previousScope.pid, sprintId: id}, op: 'remove'});
    });
    ownerScopes.set(ownerKey, {pid, sprintIds});
    const onEvent = taskSocketHandler({
        commit, dispatch, pid, sprintIds,
        showAllTasks,
        userId,
        membershipScoped: payload.membershipScoped === true,
    });
    ensureTaskSocketManager(socket, {onEvent, ownerKey, onAnyEvent: sprintCountsListener(dispatch, pid), store: commit});
    joinTaskListRooms(socket, sprintIds.map((id) => ({
        projectId: pid,
        sprintId: id,
        ...((showAllTasks === undefined || showAllTasks === true || showAllTasks === 2) ? {} : {userId}),
    })), ownerKey);
    return Promise.resolve();
};

export const subscribeBoardTaskRooms = (context, payload = {}) => getTasksFromMongoDB(context, {
    ...payload,
    sprintIds: payload.listIds || payload.sprintIds || [],
    currentView: 'tasks',
    membershipScoped: true,
});

export const unsubscribeBoardTaskRooms = ({state, rootState, commit}, payload = {}) => {
    const {ownerKey} = payload;
    if (!ownerKey) return;
    const socket = rootState.settings.socketInstance;
    leaveTaskListRooms(socket, ownerKey);
    const ownerScopes = socket && taskSocketScopesByClient.get(socket);
    const previousScope = ownerScopes?.get(ownerKey);
    const sprintIds = previousScope?.sprintIds || [];
    sprintIds.forEach((sprintId) => {
        commit('setGetPaginatedTasksPayload', {data: {pid: previousScope.pid, sprintId}, op: 'remove'});
        commit('setGetTableTaskPayload', {data: {pid: previousScope.pid, sprintId}, op: 'remove'});
    });
    ownerScopes?.delete(ownerKey);
    if (state.getTaskSnapShotPayload?.ownerKey === ownerKey) commit('setTaskSnapShotPayload', {});
};

export const getPaginatedTasks = ({state, commit}, payload) => {
    return new Promise((resolve, reject) => {
        try {
            const {pid, sprintId, item, fetchNew, parentId = "", indexName = "", showAllTasks} = payload;
            commit("setGetPaginatedTasksPayload",{data:payload,op: 'add'});
            const indName = indexName || item.indexName

            const projectFound = Object.keys(state.tasks).includes(pid);
            let sprintFound = false;
            if(projectFound) {
                sprintFound = state.tasks[pid].sprints.includes(sprintId);
            }

            if(sprintFound && !fetchNew && !payload.allPages) {
                resolve();
                return;
            }

            let cursor = null;
            let foundKey = `${item.searchKey}_${item.searchValue}`;

            const indexKey = `${parentId && parentId.length ? `${parentId}_` : ''}${item.searchKey}_${item.searchValue}`;

            if(sprintFound) {
                cursor = state.tasks[pid][sprintId].index[indexKey] || null;
            }
            if(payload.allPages && sprintFound) {
                const loaded = Number(cursor || 0);
                const total = Number(state.tasks[pid][sprintId].found?.[indexKey]);
                if(Number.isFinite(total) && loaded >= total) {
                    resolve({ responseData: [] });
                    return;
                }
            }
            // The List opening a group, or a row opening its subtasks, wants the first page only: nothing is asked when it was read before.
            if(payload.firstPageOnly && sprintFound && state.tasks[pid][sprintId].index[indexKey] !== undefined) {
                resolve();
                return;
            }
            // The List counts the rows it holds up to the last page, so a row that left the group or joined it between pages moves the start.
            if(Number.isInteger(payload.skip) && payload.skip >= 0) {
                cursor = payload.skip;
            }

            const inParent = Boolean(parentId && parentId.length);
            const queryParams = [
                {
                    $match: {
                        ...sprintTaskMatch({ pid, sprintId: inParent ? homeListOf(state, pid, sprintId, parentId) : sprintId, showAllTasks, userId: payload.userId }),
                        ...( inParent ?
                            { ParentTaskId: parentId }
                        :
                            { isParentTask: true, ...groupCondition(item) }
                        ),
                    }
                },
                { $sort: {[indName]: 1, "createdAt": 1, _id: 1}},
            ]

            const findQuery = [
                ...queryParams,
                {
                    $facet: {
                        result:[
                            { $skip: cursor || 0},
                            { $limit: 35}
                        ],
                        count:[
                            {$count: "count" }
                        ]
                    }
                }
            ]

            const flight = `${pid}|${sprintId}|${indexKey}|${cursor || 0}`;
            if(pagesInFlight.has(flight)) {
                pagesInFlight.get(flight).then(resolve, reject);
                return;
            }

            const page = apiRequest('post',`${env.TASK}/find`,{findQuery: findQuery, ...(inParent ? {} : { inList: sprintId })})
            .then((resp) => {
                if(resp.status === 200){
                    const response = resp.data[0];
                    const responseData = response.result;

                    let resCount = {};
    
                    if (parentId && parentId.length) {
                        resCount = { [foundKey]: state.tasks[pid]?.[sprintId]?.found?.[foundKey] || 0 };
                    } else if (sprintFound && state.tasks[pid]?.[sprintId]?.found?.[foundKey]) {
                        if (response.count?.[0]?.count) {
                            resCount = { [foundKey]: response?.count[0]?.count || 0 };
                        } else {
                            // resCount = { [foundKey]: state.tasks[pid][sprintId].found[foundKey] || 0};
                            resCount = { [foundKey]: (state.tasks[pid][sprintId].found[foundKey] === 1 ? 0 : state.tasks[pid][sprintId].found[foundKey]) || 0 };
                        }
                    } else {
                        resCount = { [foundKey]: response.count?.[0]?.count || 0 };
                    }
    
                    // SET CURSOR
                    if(responseData && responseData.length) {
                        // BUG-017 / #71 fix: body is fully synchronous (Date
                        // construction + Vuex commit). Drop the unused
                        // `async` keyword.
                        responseData.forEach((task) => {
                            const doc = task;

                            if(doc.startDate && doc.startDate > 0) {
                                doc.startDate = new Date(doc.startDate * 1000);
                            }

                            if(doc.DueDate && doc.DueDate > 0) {
                                doc.DueDate = new Date(doc.DueDate * 1000);
                                // doc.dueDateDeadLine = doc.dueDateDeadLine.map((x) => JSON.parse(x)).map((x) => ({date: new Date(x.date * 1000)}));
                            }

                            commit('mutateTypesenseTasks', {found: resCount, nextPage: {[indexKey]: (cursor || 0) + responseData?.length || 0}, pid: pid, sprintId: sprintId, data: {...doc}})
                        })
                        const last = responseData[responseData.length - 1];
                        commit('mutatePageFrontier', {pid, sprintId, key: indexKey, row: {index: last[indName] ?? null, createdAt: last.createdAt ?? null, _id: last._id}});
                    } else {
                        commit('mutateTypesenseTasks', {found: resCount, nextPage: {[indexKey]: (cursor || 0) + responseData?.length || 0}, pid: pid, sprintId: sprintId, data: null})
                    }

                    const total = Number(response.count?.[0]?.count || 0);
                    if(payload.allPages && responseData?.length && (Number(cursor || 0) + responseData.length) < total) {
                        return getPaginatedTasks({state, commit}, {
                            ...payload,
                            fetchNew: true,
                            skip: Number(cursor || 0) + responseData.length
                        }).then((next) => ({
                            responseData: [...responseData, ...(next?.responseData || [])],
                            count: total
                        }));
                    }

                    return {responseData, count: total};
                }
                return Promise.reject();
            });

            pagesInFlight.set(flight, page);
            page.then(resolve, reject).finally(() => pagesInFlight.delete(flight));

        } catch (error) {
            reject(error);
        }
    })
}

function boardGroupCursor(bucket, item, indexKey) {
    const cursor = Number(bucket?.index?.[indexKey] || 0);
    const frontier = bucket?.frontier?.[indexKey];
    if (!frontier) return cursor;
    const loadedRows = (bucket?.tasks || []).filter((row) => row?.isParentTask !== false && !row?.deletedStatusKey && taskInGroup(row, item));
    return pagedPast(loadedRows, frontier, item?.indexName || 'groupByStatusIndex') ?? cursor;
}

/* Board's aggregate view reads a bounded batch of groups from each list. Each group keeps its
   existing Vuex cursor/count, while a single facet request returns up to 35 rows and the exact
   count for every group in the batch. */
export const getBoardGroupPages = async ({state, commit}, payload = {}) => {
    const {pid, buckets = [], firstPageOnly = false, fetchNew = false, showAllTasks, userId} = payload;
    const jobs = [];

    for (const source of buckets) {
        const sprintId = String(source?.sprintId || '');
        if (!sprintId) continue;
        const readyItems = (source.items || []).filter((item) => {
            const indexKey = boardGroupIndexKey(item);
            const foundKey = boardGroupFoundKey(item);
            const bucket = state.tasks?.[pid]?.[sprintId];
            const cursorExists = Object.prototype.hasOwnProperty.call(bucket?.index || {}, indexKey);
            const cursor = boardGroupCursor(bucket, item, indexKey);
            const found = Number(bucket?.found?.[foundKey]);

            if (firstPageOnly && cursorExists) return false;
            if (!fetchNew && cursorExists) return false;
            // A subtask read can leave a zero count for its parent group without creating that
            // group's page cursor. Only treat a group as exhausted after its own cursor exists.
            if (fetchNew && cursorExists && Number.isFinite(found) && cursor >= found) return false;
            return true;
        });

        readyItems.forEach((item) => commit('setGetPaginatedTasksPayload', {
            data: {pid, sprintId, item, indexName: item.indexName, fetchNew, showAllTasks, userId},
            op: 'add',
        }));
        for (const items of boardGroupPageBatches(readyItems)) {
            jobs.push({sprintId, items});
        }
    }

    const queue = [...jobs];
    const failed = [];
    const workerCount = Math.min(4, queue.length);
    const workers = Array.from({length: workerCount}, async () => {
        while (queue.length) {
            const {sprintId, items} = queue.shift();
            const bucket = state.tasks?.[pid]?.[sprintId];
            const cursors = Object.fromEntries(items.map((item) => {
                const key = boardGroupIndexKey(item);
                return [key, boardGroupCursor(bucket, item, key)];
            }));
            const request = buildBoardGroupPageQuery({pid, sprintId, items, cursors, showAllTasks, userId});
            const key = boardGroupPageFlightKey({pid, sprintId, items, cursors, showAllTasks, userId});

            try {
                const response = await coalesceBoardGroupPageFlight(key, () =>
                    apiRequest('post', `${env.TASK}/find`, {findQuery: request.findQuery, inList: request.inList})
                );
                if (response?.status !== 200) throw new Error(`Board task query failed for list ${sprintId}`);

                const facetDoc = response.data?.[0] || {};
                const entries = readBoardGroupPageBatch({items, facetDoc, cursors});
                for (const entry of entries) {
                    for (const task of entry.rows) {
                        if (task.startDate && task.startDate > 0) task.startDate = new Date(task.startDate * 1000);
                        if (task.DueDate && task.DueDate > 0) task.DueDate = new Date(task.DueDate * 1000);
                        commit('mutateTypesenseTasks', {
                            pid,
                            sprintId,
                            found: {[entry.foundKey]: entry.count},
                            nextPage: {[entry.indexKey]: entry.nextCursor},
                            data: task,
                        });
                    }
                    if (!entry.rows.length) {
                        commit('mutateTypesenseTasks', {
                            pid,
                            sprintId,
                            found: {[entry.foundKey]: entry.count},
                            nextPage: {[entry.indexKey]: entry.nextCursor},
                            data: null,
                        });
                    }
                    const last = entry.rows[entry.rows.length - 1];
                    if (last) {
                        commit('mutatePageFrontier', {
                            pid,
                            sprintId,
                            key: entry.indexKey,
                            row: {index: last[entry.item.indexName] ?? null, createdAt: last.createdAt ?? null, _id: last._id},
                        });
                    }
                }
            } catch (error) {
                failed.push({
                    sprintId,
                    groupKeys: items.map((item) => boardGroupFoundKey(item)),
                    error,
                });
            }
        }
    });

    await Promise.all(workers);
    return {failed};
};

/* The server's count for every group of a sprint, and the totals of the columns named, in one request.
   Socket events can only adjust a count for a task the store holds; for any other change the List asks again. */
export const refreshGroupCounts = ({state, commit}, payload) => {
    const {pid, sprintId, items = [], showAllTasks, userId, totals = [], table = false} = payload;
    if(!items.length || (!table && !state.tasks?.[pid]?.sprints?.includes(sprintId))) return Promise.resolve();

    return apiRequest('post',`${env.TASK}/find`,{findQuery: groupCountsQuery({ pid, sprintId, items, showAllTasks, userId, totals }), inList: sprintId})
    .then((resp) => {
        if(resp.status !== 200) return;
        commit(table ? 'mutateTableGroupCounts' : 'mutateGroupCounts', {
            pid, sprintId,
            found: readGroupCounts(items, resp.data?.[0]),
            totals: totals.length ? readGroupTotals(items, resp.data?.[0], totals) : null
        });
    });
}

export const keepRequestsOfGroups = ({commit}, payload) => commit('keepRequestsOfGroups', payload);

export const tabSyncTaskCommit = ({state,commit},payload) => {
    try {
        const {response,payloadObjcet} = payload;
        const responseData = response?.data[0]?.result || [];
        const {pid, sprintId, item, parentId = ""} = payloadObjcet;
        let resCount = {};
        const projectFound = Object.keys(state.tasks).includes(pid);
        let sprintFound = false;
        const indexKey = `${parentId && parentId.length ? `${parentId}_` : ''}${item.searchKey}_${item.searchValue}`;
        let cursor = null;
        if(projectFound) {
            sprintFound = state.tasks[pid].sprints.includes(sprintId);
        }
        if(sprintFound) {
            cursor = state.tasks[pid][sprintId].index[indexKey] || null;
        }
        let foundKey = `${item.searchKey}_${item.searchValue}`;
        resCount = {[foundKey]: response.data[0]?.count?.[0]?.count || 0}
        // SET CURSOR
        if(responseData && responseData.length) {
            // BUG-017 / #71 fix: body is fully synchronous. Drop the unused
            // `async` keyword.
            responseData.forEach((task) => {
                const doc = task;

                if(doc.favouriteTasks && doc.favouriteTasks.length && typeof doc.favouriteTasks[0] === "string") {
                    doc.favouriteTasks = doc.favouriteTasks.map((x) => ({userId: x}))
                }
                if(doc.startDate && doc.startDate > 0) {
                    doc.startDate = new Date(doc.startDate * 1000);
                }

                if(doc.DueDate && doc.DueDate > 0) {
                    doc.DueDate = new Date(doc.DueDate * 1000);
                }

                commit('mutateTypesenseTasks', {found: resCount, nextPage: {[indexKey]: (cursor || 0) + responseData?.length || 0}, pid: pid, sprintId: sprintId, data: {...doc}})
            })
        } else {
            commit('mutateTypesenseTasks', {found: resCount, nextPage: {[indexKey]: (cursor || 0) + responseData?.length || 0}, pid: pid, sprintId: sprintId, data: null})
        }
    } catch (error) {
        console.error(error);
    }
}

export const setTableTasksFromTypesense = ({ state, commit, rootGetters }, payload) => {
    return new Promise((resolve, reject) => {
        try {
            const {pid, sprintId, item, fetchNew, parentId = "",sortKey = '',isFirst=false,resetTable=false} = payload;
            commit("setGetTableTaskPayload",{data:payload,op: 'add'});
            const projectFound = Object.keys(state.tableTasks).includes(pid);
            let sprintFound = false;
            if(projectFound) {
                sprintFound = state.tableTasks[pid].sprints.includes(sprintId);
            }

            if(sprintFound && (!fetchNew || resetTable === false)) {
                resolve();
                return;
            }
            let page = 0;
            let skip = 0;
            let batchSize = 35;

            const indexKey = `${parentId && parentId.length ? `${parentId}_` : ''}${item.searchKey}_${item.searchValue}`;
            if(sprintFound) {
                // A group the sprint has no page of yet (a status the project gained while the Table was open) starts at its first row.
                const read = state.tableTasks[pid][sprintId].index[indexKey];
                page = read === undefined ? 0 : (read || 1);
                skip = page * batchSize;
            }
            if((sortKey && sortKey.length && isFirst) || (resetTable === true)){
                state.tableTasks = {};
                page = 0;
                skip = 0;
                batchSize = 35;
            }            
            let queryDetail = [
                {
                    $match: {
                        $and: [
                            {
                                $and:[
                                    {ProjectID:
                                        {
                                            objId: {
                                                $in : [pid]
                                            }
                                        } 
                                    },
                                    {sprintId: 
                                        {
                                            objId: {
                                                $eq:sprintId
                                            }
                                        }
                                    },
                                    {deletedStatusKey: { $in: [0] }},
                                    {isParentTask: true},
                                ]
                            },
                            {
                                ...( item.mongoConditions?.length ? 
                                    { ...item.mongoConditions[0] }
                                :
                                    item?.conditions?.length ?
                                        { ...item.conditions[0] }
                                    :
                                        {}
                                )
                            },
                            {
                                ...(payload?.showAllTasks !== undefined && !payload?.showAllTasks && {
                                    $and: [
                                        {AssigneeUserId: {$in : [payload.userId]}}
                                    ],
                                }),
                            },
                            {
                                ...(pid !== "6571e7195470e64b1203295c" ? {} : {AssigneeUserId: {$in: [payload.userId]}}),
                            }
                        ],
                    },
                },
                ...(sortKey ? tableSortStages(sortKey, rootGetters?.['settings/finalCustomFields'], { users: rootGetters?.['users/users'] }) : [{ $sort: item?.indexName ? { [item.indexName]: 1 } : { createdAt: 1 } }]),
                {
                    $skip: skip,
                },
                {
                    $limit: batchSize,
                },
            ]
            apiRequest('post',`${env.TASK}/find`,{findQuery: queryDetail, inList: sprintId})
            .then((result) => {
                if(result && result.status === 200 && result?.data && result?.data.length){
                    result?.data.forEach((task) => {
                        const doc = task;
                        if(doc.startDate && doc.startDate > 0) {
                            doc.startDate = (new Date(doc.startDate));
                        }
                        if(doc.DueDate && doc.DueDate > 0) {
                            doc.DueDate = (new Date(doc.DueDate));
                            doc.dueDateDeadLine = doc.dueDateDeadLine.map((x) => JSON.parse(x)).map((x) => ({date: (new Date(x.date))}));
                        }
                        commit('mutateTypesenseTableTasks', {nextPage: {[indexKey]: page+1}, pid, sprintId, data: {...doc}, total: result?.data.found})
                    })
                } else {
                    commit('mutateTypesenseTableTasks', {nextPage: {[indexKey]: page}, pid, sprintId, data: null})
                }
                resolve({result:result?.data, page});
            })
            .catch((error) => {
                reject(error);
            })
        } catch (error) {
            reject(error);
        }
    })
}

export const tabSyncTableCommit = ({state,commit},payload) => {
    try {
        const {response,payloadObjcet} = payload;
        const result = response?.data || [];
        const {pid, sprintId, item, parentId = ""} = payloadObjcet;
        const indexKey = `${parentId && parentId.length ? `${parentId}_` : ''}${item.searchKey}_${item.searchValue}`;
        const projectFound = Object.keys(state.tableTasks).includes(pid);
        let sprintFound = false;
        if(projectFound) {
            sprintFound = state.tableTasks[pid].sprints.includes(sprintId);
        }
        let page = 0;
        if(sprintFound) {
            page = state.tableTasks[pid][sprintId].index[indexKey] || 1;
        }
        if(result && result.length){
            result.forEach((task) => {
                const doc = task;
                if(doc.startDate && doc.startDate > 0) {
                    doc.startDate = (new Date(doc.startDate));
                }
                if(doc.DueDate && doc.DueDate > 0) {
                    doc.DueDate = (new Date(doc.DueDate));
                    doc.dueDateDeadLine = doc.dueDateDeadLine.map((x) => JSON.parse(x)).map((x) => ({date: (new Date(x.date))}));
                }
                commit('mutateTypesenseTableTasks', {nextPage: {[indexKey]: page+1}, pid, sprintId, data: {...doc}, total: result.found})
            })
        } else {
            commit('mutateTypesenseTableTasks', {nextPage: {[indexKey]: page}, pid, sprintId, data: null})
        }
    } catch (error) {
        console.error(error);
    }
}

let searcAbortController;
export const searchTask = ({commit}, payload) => {
    return new Promise((resolve, reject) => {
        try {
            if(searcAbortController) {
                searcAbortController.abort();
                searcAbortController = null;
            }
            searcAbortController = new AbortController();
            const signal = searcAbortController.signal;

            apiRequest('post',`${env.TASK}/find`,{findQuery: payload.query}, "JSON", {signal})
            .then((resp) => {
                if(resp.status === 200){
                    const results = resp.data;
                    // A match on the second or third level is shown under every row above it, so each of those is read too.
                    const requiredParents = results.filter((x) => !x.isParentTask).flatMap((x) => [...ancestorsOf(x), x.ParentTaskId]).filter(Boolean).map(String);
                    const availableParents = results.map((x) => String(x._id));
                    const parentIds = [...new Set(requiredParents)].filter((x) => !availableParents.includes(x));
                    if(parentIds?.length) {
                        let query = [
                            {
                                $match: {
                                    $and:[
                                        {
                                            _id: { objId: {$in: parentIds.map(id => id)} }
                                        },
                                        {deletedStatusKey: { $in: payload.showArchived === true ? [0,2] : [0] }}
                                    ]
                                }
                            }
                        ]
                        apiRequest('post',`${env.TASK}/find`,{findQuery: query})
                        .then((results2) => {
                            if(results2 && results2?.status === 200 && results2?.data){
                                resolve([...results, ...results2.data]);
                                commit("mutateSearchTask", {data: [...results, ...results2.data],op:"added"});
                            }else{
                                resolve([...results]);
                                commit("mutateSearchTask", {data: [...results],op:"added"});
                            }
                        })
                        .catch((error) => {
                            reject(error);
                        })
                    } else {
                        resolve(results);
                        commit("mutateSearchTask", {data: results,op:"added"});
                    }
                }
                else{
                    reject();
                }
            })
            .catch((error) => {
                reject(error);
            })
        } catch (error) {
            reject(error);
        }
    })
}

export const setprojectTemplate = ({ state, commit }) => {
    return new Promise((resolve, reject) => {
        try {
            state.projectTemplate = {};
            apiRequest("get", `${env.PROJECT_TEMPLATE}`).then((response) => {
                let result = [];
                if (response.data.status) {
                    const data = response.data.data;
                    data.forEach((change) => {
                        result.push({ op: 'add', data: { ...change, id: change._id } });
                    })
                }
                commit("mutateprojectTemplate", result);
                resolve()
            }).catch((error) => {
                reject(error);
                console.error("Error while getting project template", error);
            })
        }
        catch (error) {
            reject(error);
        }
    })
}

export const setSprints = ({commit }, payload) => {
    return new Promise((resolve,reject) => {
        try {
            apiRequest("get", `/api/v1/${env.GET_SPRINT_OR_PROJECT}/${payload?.projectId}?collection=sprints`).then((resp) => {
                let res = resp?.data || [];
                let result = [];
                res.map(x => {
                    const obj = {op: "added", data: {...x}}
                    commit('mutateSprints', obj);
                    result.push(obj);
                })
                resolve(res);
            })
            .catch((error) => {
                reject(error)
            })
        } catch (error) {
            reject(error)
        }
    })
}

export const setFolders = ({ commit }, payload) => {
    return new Promise((resolve,reject) => {
        try {
            apiRequest("get", `/api/v1/${env.GET_SPRINT_OR_PROJECT}/${payload?.projectId}?collection=folders`).then((resp) => {
                let res = resp?.data || [];
                let result = [];
                res.map(x => {
                    const obj = {op: "added", data: {...x}}
                    commit('mutateFolders', obj);
                    result.push(obj);
                })
                resolve(res);
            })
            .catch((error) => {
                reject(error)
            })
        } catch (error) {
            reject(error)
        }
    })
}

export const searchProjects = ({ commit }, payload) => {
    return new Promise((resolve, reject) => {
      try {
        if (payload.type !== 'projectName') {
            delete payload.projectList
            apiRequest("post", `${env.PROJECTSEARCH}`, payload).then((serachedData)=>{
                commit("mutateSearchedProjects", { data: serachedData?.data || [], searchType: payload.type });
                resolve({ data: serachedData?.data, searchType: payload.type } || []);
            }).catch((error)=>{
                reject(error)
            })
        } 
        else {
            let searchedProjects = payload.projectList.filter((x)=> x.ProjectName.toLowerCase().includes(payload.search.toLowerCase()))
            commit("mutateSearchedProjects", { data: searchedProjects || [], searchType: payload.type });
        }
      } catch (error) {
        reject(error);
      }
    });
  };



export const getTaskDetailSnapShot = ({  commit,rootState  }, payload)   => {
    commit("setTaskdetailPayloadId",payload);
    rootState.settings?.socketInstance?.emit('joinTaskDetail',{taskId: payload.taskId, socketId: rootState.settings.socketInstance.id});
    rootState.settings?.socketInstance?.on('taskDetail_taskUpdate',(data)=>{
        commit('setTaskDetailData',data);
    })
    rootState.settings?.socketInstance?.on('taskDetail_taskInsert',(data)=>{
        commit('setTaskDetailData',data);
    })
        rootState.settings?.socketInstance?.on('taskDetail_taskDelete',()=>{
        commit('setTaskDetailData',{});
    })
}

export const getAllTask = ({ commit }, payload) => {
    return new Promise((resolve, reject) => {
        try {
            const { projectIds, sprintIds, skip, parentId = "" } = payload;
            let queryObj = [
                {
                    $match:
                    {
                        ProjectID: { objId: { $in: projectIds.map((x) => x) } },
                        sprintId: { objId: { $in: sprintIds.map((x) => x) } },
                        deletedStatusKey: { $in: [0, undefined] },
                        ...(parentId && parentId.length ?
                            { ParentTaskId: parentId }
                            :
                            {
                                isParentTask: true,
                            }
                        ),
                    }
                },
                { $sort: { createdAt: -1, _id: 1 } },
                { $skip: skip },
                {
                    $limit: 15,
                }
            ]
            apiRequest('post', `${env.TASK}/find`, { findQuery: queryObj }).then((resp) => {
                let res = resp?.data || [];
                let result = [];
                res.map(x => {
                    const obj = { op: "added", data: { ...x }, projectIds: projectIds }
                    commit('mutateAllTask', obj);
                    result.push(obj);
                })
                resolve(res);
            })
                .catch((error) => {
                    reject(error)
                })
        } catch (error) {
            reject(error)
        }
    })
}
