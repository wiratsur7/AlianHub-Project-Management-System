const EVENT_NAMES = Object.freeze(["taskInsert", "taskUpdate", "taskDelete", "taskReplace"]);
const managers = new WeakMap();
const MAX_SEEN_EVENTS = 2048;

const same = (left, right) => String(left ?? "") === String(right ?? "");
const roomKeyOf = ({ projectId, sprintId }) => `${String(projectId)}:${String(sprintId)}`;
const roomNameOf = (socket, scope) => `project_sprint_${scope.projectId}_${scope.sprintId}**${socket.id}`;

function normalizeScopes(scopes) {
    const found = new Map();
    (Array.isArray(scopes) ? scopes : [scopes]).forEach((scope) => {
        if (!scope || typeof scope !== "object") return;
        const projectId = String(scope.projectId || scope.ProjectID || "");
        const sprintId = String(scope.sprintId || scope.id || scope._id || "");
        if (!projectId || !sprintId) return;
        const normalized = { projectId, sprintId };
        if (scope.userId) normalized.userId = String(scope.userId);
        found.set(roomKeyOf(normalized), normalized);
    });
    return found;
}

function eventMembershipIds(payload) {
    if (payload?.membershipSprintId) return [String(payload.membershipSprintId)];
    const task = payload?.fullDocument || payload?.documentKey || {};
    return [...new Set([
        task.sprintId,
        ...(Array.isArray(task.extraLists) ? task.extraLists.map((entry) => entry?.sprintId) : []),
    ].filter(Boolean).map(String))];
}

function dedupeIdOf(eventName, payload) {
    if (payload?.eventId) return String(payload.eventId);
    const task = payload?.fullDocument || payload?.documentKey || {};
    try {
        const source = JSON.stringify([eventName, task._id, payload?.updatedFields || {}, task]);
        let hash = 2166136261;
        for (let index = 0; index < source.length; index += 1) {
            hash ^= source.charCodeAt(index);
            hash = Math.imul(hash, 16777619);
        }
        return `legacy:${hash >>> 0}:${source.length}`;
    } catch (_error) {
        return "";
    }
}

function createManager(socket, store) {
    const rooms = new Map();
    const owners = new Map();
    const handlers = new Map();
    const anyHandlers = new Map();
    const listeners = [];
    const seenEvents = new Map();
    let defaultOnEvent = null;

    const callbackFor = (ownerKey) => handlers.get(ownerKey) || defaultOnEvent;

    function rememberEvent(eventId, membershipSprintId) {
        if (!eventId) return false;
        const key = `${eventId}:${membershipSprintId}`;
        if (seenEvents.has(key)) return true;
        seenEvents.set(key, Date.now());
        if (seenEvents.size > MAX_SEEN_EVENTS) {
            const removeCount = seenEvents.size - MAX_SEEN_EVENTS;
            let removed = 0;
            for (const oldKey of seenEvents.keys()) {
                seenEvents.delete(oldKey);
                removed += 1;
                if (removed >= removeCount) break;
            }
        }
        return false;
    }

    function routeEvent(eventName, payload) {
        anyHandlers.forEach((onAny) => {
            try {
                onAny(eventName, payload);
            } catch (error) {
                console.error("ERROR in task socket subscription: ", error);
            }
        });
        const membershipIds = eventMembershipIds(payload);
        const dedupeId = dedupeIdOf(eventName, payload);
        for (const membershipSprintId of membershipIds) {
            if (rememberEvent(dedupeId, membershipSprintId)) continue;
            for (const room of rooms.values()) {
                if (!same(room.sprintId, membershipSprintId)) continue;
                const context = {
                    membershipSprintId,
                    eventId: payload?.eventId || dedupeId,
                    eventName,
                    payload,
                };
                for (const ownerKey of room.owners) {
                    const onEvent = callbackFor(ownerKey);
                    if (typeof onEvent !== "function") continue;
                    try {
                        onEvent(context);
                    } catch (error) {
                        console.error("ERROR in task socket subscription: ", error);
                    }
                }
            }
        }
    }

    EVENT_NAMES.forEach((eventName) => {
        const listener = (payload) => routeEvent(eventName, payload);
        listeners.push([eventName, listener]);
        socket.on(eventName, listener);
    });

    function effectiveUserId(room) {
        const userIds = [...room.owners].map((ownerKey) => room.userIds.get(ownerKey) || "");
        if (!userIds.length || userIds.some((userId) => !userId)) return "";
        const unique = [...new Set(userIds)];
        return unique.length === 1 ? unique[0] : "";
    }

    function joinRoom(room, force = false) {
        const userId = effectiveUserId(room);
        const socketId = String(socket.id || "");
        if (socket.connected === false) {
            room.joined = false;
            room.pending = false;
            room.pendingUserId = "";
            room.socketId = "";
            return;
        }
        if (!force && room.joined && room.socketId === socketId && same(room.joinedUserId, userId)) return;
        if (!force && room.pending && room.socketId === socketId && same(room.pendingUserId, userId)) return;

        const payload = { projectId: room.projectId, sprintId: room.sprintId, socketId };
        if (userId) payload.userId = userId;
        const requestId = (room.requestId || 0) + 1;
        room.requestId = requestId;
        room.pending = true;
        room.pendingUserId = userId;
        room.socketId = socketId;
        socket.emit("joinProjectSprintForTask", payload, (answer) => {
            if (room.requestId !== requestId || !rooms.has(room.key)) return;
            room.joined = Boolean(answer?.joined);
            room.pending = false;
            room.socketId = socketId;
            room.joinedUserId = userId;
        });
    }

    function leaveRoom(room) {
        room.requestId = (room.requestId || 0) + 1;
        if (room.joined || room.pending || room.socketId === String(socket.id || "")) {
            socket.emit("leaveProjectSprintForTask", roomNameOf(socket, room));
        }
        room.joined = false;
        room.pending = false;
        room.pendingUserId = "";
        room.socketId = "";
        room.joinedUserId = "";
    }

    socket.on("disconnect", () => {
        rooms.forEach((room) => {
            room.joined = false;
            room.pending = false;
            room.pendingUserId = "";
            room.socketId = "";
        });
    });
    socket.on("connect", () => rooms.forEach((room) => joinRoom(room, true)));

    function joinTaskListRooms(scopes, ownerKey) {
        if (ownerKey === undefined || ownerKey === null) return;
        const next = normalizeScopes(scopes);
        const previous = owners.get(ownerKey) || new Map();

        previous.forEach((_scope, key) => {
            if (next.has(key)) return;
            const room = rooms.get(key);
            if (!room) return;
            room.owners.delete(ownerKey);
            room.userIds.delete(ownerKey);
            if (!room.owners.size) {
                leaveRoom(room);
                rooms.delete(key);
            } else {
                joinRoom(room);
            }
        });

        next.forEach((scope, key) => {
            let room = rooms.get(key);
            if (!room) {
                room = {
                    key,
                    projectId: scope.projectId,
                    sprintId: scope.sprintId,
                    owners: new Set(),
                    userIds: new Map(),
                    joined: false,
                    pending: false,
                    pendingUserId: "",
                    socketId: "",
                    joinedUserId: "",
                    requestId: 0,
                };
                rooms.set(key, room);
            }
            const previousUserId = room.userIds.get(ownerKey) || "";
            room.owners.add(ownerKey);
            room.userIds.set(ownerKey, scope.userId || "");
            if (!room.joined || !previous.has(key) || !same(previousUserId, scope.userId || "")) joinRoom(room);
        });

        owners.set(ownerKey, next);
    }

    function leaveTaskListRooms(ownerKey) {
        const previous = owners.get(ownerKey);
        if (!previous) return;
        previous.forEach((_scope, key) => {
            const room = rooms.get(key);
            if (!room) return;
            room.owners.delete(ownerKey);
            room.userIds.delete(ownerKey);
            if (!room.owners.size) {
                leaveRoom(room);
                rooms.delete(key);
            } else {
                joinRoom(room);
            }
        });
        owners.delete(ownerKey);
        handlers.delete(ownerKey);
        anyHandlers.delete(ownerKey);
    }

    function setOnAnyEvent(onAnyEvent, ownerKey) {
        if (typeof onAnyEvent === "function" && ownerKey !== undefined && ownerKey !== null) anyHandlers.set(ownerKey, onAnyEvent);
    }

    function dispose() {
        listeners.forEach(([eventName, listener]) => socket.off?.(eventName, listener));
    }

    function setOnEvent(onEvent, ownerKey) {
        if (typeof onEvent !== "function") return;
        if (ownerKey === undefined || ownerKey === null) defaultOnEvent = onEvent;
        else handlers.set(ownerKey, onEvent);
    }

    return { joinTaskListRooms, leaveTaskListRooms, setOnEvent, setOnAnyEvent, dispose, store, rooms };
}

/** Install exactly one stable listener set on this socket and return its shared room manager. */
export function ensureTaskSocketManager(socket, { onEvent, onAnyEvent, ownerKey, store } = {}) {
    if (!socket || typeof socket.on !== "function" || typeof socket.emit !== "function") return null;
    let manager = managers.get(socket);
    if (manager && store !== undefined && manager.store !== undefined && manager.store !== store) {
        manager.dispose();
        manager = null;
    }
    if (!manager) {
        manager = createManager(socket, store);
        managers.set(socket, manager);
    }
    if (typeof onEvent === "function") {
        manager.setOnEvent(onEvent, ownerKey);
    }
    manager.setOnAnyEvent(onAnyEvent, ownerKey);
    return manager;
}

/** Join each list separately so the server can retain its existing per-list permission check. */
export function joinTaskListRooms(socket, scopes, ownerKey) {
    ensureTaskSocketManager(socket)?.joinTaskListRooms(scopes, ownerKey);
}

/** Leave a list room only after its final local owner has released it. */
export function leaveTaskListRooms(socket, ownerKey) {
    if (!socket || (typeof socket !== "object" && typeof socket !== "function")) return;
    managers.get(socket)?.leaveTaskListRooms(ownerKey);
}
