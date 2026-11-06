const { test, expect, asRole } = require('../support/test');
const { createProject, createTask, readTask, uniqueSuffix } = require('../support/fixtures');

const DAY_MS = 24 * 60 * 60 * 1000;

test.describe('Gantt timeline gestures', () => {
    test.use({ ...asRole('owner'), timezoneId: 'UTC', viewport: { width: 1920, height: 1080 } });

    test('pans through empty timeline space in both directions without changing task dates', async ({ page, state, loginAs }) => {
        const owner = await loginAs('owner');
        const scenario = await createScenario(owner, state, 'pan');

        try {
            await openChart(page, state, scenario.project);
            await centerTimelineScroll(page);
            await expect(barFor(page, scenario.tasks.focus._id)).toBeVisible({ timeout: 30000 });
            await selectDayZoom(page);
            await waitForRenderFrames(page);

            const original = await readTask(owner.api, scenario.tasks.focus._id);
            const dateWrites = watchDateWrites(page);
            const initialAxis = await axisBounds(page);
            const initialTimeline = await timelineMetrics(page);

            let later = await panUntilRangeExtends(page, 'later');
            for (let range = 1; range < 3; range += 1) later = await panUntilRangeExtends(page, 'later');
            expect(later.timeline.scrollWidth).toBeGreaterThan(initialTimeline.scrollWidth + 2);
            expect(later.axis.last).not.toBe(initialAxis.last);

            await positionTimelineNearEdge(page, 'earlier');
            const beforeEarlierAxis = await axisBounds(page);
            const beforeEarlierTimeline = await timelineMetrics(page);
            let earlier = await panUntilRangeExtends(page, 'earlier');
            for (let range = 1; range < 3; range += 1) earlier = await panUntilRangeExtends(page, 'earlier');
            expect(earlier.timeline.scrollWidth).toBeGreaterThan(beforeEarlierTimeline.scrollWidth + 2);
            expect(earlier.axis.first).not.toBe(beforeEarlierAxis.first);

            expect(dateWrites).toEqual([]);
            expect(calendarDay(original.startDate)).toBe(calendarDay((await readTask(owner.api, scenario.tasks.focus._id)).startDate));
            expect(calendarDay(original.DueDate)).toBe(calendarDay((await readTask(owner.api, scenario.tasks.focus._id)).DueDate));

            await reloadChart(page, scenario.tasks.focus._id);
            const afterReload = await readTask(owner.api, scenario.tasks.focus._id);
            expect(calendarDay(afterReload.startDate)).toBe(calendarDay(original.startDate));
            expect(calendarDay(afterReload.DueDate)).toBe(calendarDay(original.DueDate));
        } finally {
            await archiveProject(owner.api, scenario.project._id);
        }
    });

    test('moves the task body and resizes each edge without panning, persisting each date change after reload', async ({ page, state, loginAs }) => {
        const owner = await loginAs('owner');
        const scenario = await createScenario(owner, state, 'dates');

        try {
            await openChart(page, state, scenario.project);
            const focusBar = barFor(page, scenario.tasks.focus._id);
            const nearbyBar = barFor(page, scenario.tasks.nearby._id);
            await expect(focusBar).toBeVisible({ timeout: 30000 });

            const weekWidth = await scaleCellWidth(page);
            expect(weekWidth).toBeGreaterThan(5);
            let before = await readTask(owner.api, scenario.tasks.focus._id);
            const duration = calendarDay(before.DueDate) - calendarDay(before.startDate);
            let anchorX = await leftOf(nearbyBar);

            await saveAfterDrag(page, scenario.tasks.focus._id, async () => {
                await dragBar(page, focusBar, { part: 'body', deltaX: weekWidth });
            });
            let after = await readTask(owner.api, scenario.tasks.focus._id);
            const movedDays = calendarDay(after.startDate) - calendarDay(before.startDate);
            expect(movedDays).not.toBe(0);
            expect(calendarDay(after.DueDate) - calendarDay(before.DueDate)).toBe(movedDays);
            expect(calendarDay(after.DueDate) - calendarDay(after.startDate)).toBe(duration);
            await expectNoPan(page, nearbyBar, anchorX);
            await reloadAndExpectDates(page, owner.api, scenario.tasks.focus._id, after);

            before = await readTask(owner.api, scenario.tasks.focus._id);
            anchorX = await leftOf(nearbyBar);
            await saveAfterDrag(page, scenario.tasks.focus._id, async () => {
                await dragBar(page, focusBar, { part: 'left', deltaX: -weekWidth });
            });
            after = await readTask(owner.api, scenario.tasks.focus._id);
            expect(calendarDay(after.startDate) - calendarDay(before.startDate)).toBeLessThan(0);
            expect(calendarDay(after.DueDate)).toBe(calendarDay(before.DueDate));
            await expectNoPan(page, nearbyBar, anchorX);
            await reloadAndExpectDates(page, owner.api, scenario.tasks.focus._id, after);

            before = await readTask(owner.api, scenario.tasks.focus._id);
            anchorX = await leftOf(nearbyBar);
            await saveAfterDrag(page, scenario.tasks.focus._id, async () => {
                await dragBar(page, focusBar, { part: 'right', deltaX: weekWidth });
            });
            after = await readTask(owner.api, scenario.tasks.focus._id);
            expect(calendarDay(after.startDate)).toBe(calendarDay(before.startDate));
            expect(calendarDay(after.DueDate) - calendarDay(before.DueDate)).toBeGreaterThan(0);
            await expectNoPan(page, nearbyBar, anchorX);
            await reloadAndExpectDates(page, owner.api, scenario.tasks.focus._id, after);
        } finally {
            await archiveProject(owner.api, scenario.project._id);
        }
    });
});

async function createScenario(owner, state, label) {
    const suffix = uniqueSuffix();
    const project = await createProject(owner.api, {
        name: `E2E Gantt ${label} ${suffix}`,
        assigneeIds: [owner.uid],
        createdBy: owner.uid,
    });
    const user = state.users.owner;
    const companyOwnerId = state.users.owner.userId;
    const tasks = {};
    for (const key of ['early', 'nearby', 'focus', 'late']) {
        tasks[key] = await createTask(owner.api, {
            project,
            name: `Gantt ${label} ${key} ${suffix}`,
            user,
            companyOwnerId,
        });
    }

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const schedules = label === 'pan'
        ? { early: [-21, -20], nearby: [-8, -7], focus: [-2, 1], late: [20, 21] }
        : { early: [-35, -34], nearby: [-34, -33], focus: [-35, -33], late: [-32, -31] };
    for (const [key, [startOffset, endOffset]] of Object.entries(schedules)) {
        const taskData = await readTask(owner.api, tasks[key]._id);
        const response = await owner.api.patch('/api/v2/tasks', {
            action: 'updateDates',
            firebaseObj: {
                startDate: addDays(today, startOffset),
                DueDate: addDays(today, endOffset),
            },
            projectData: { _id: project._id, ProjectName: project.ProjectName, CompanyId: state.companyId },
            taskData,
            userData: { Employee_Name: 'Olivia Owner', id: owner.uid, companyOwnerId },
        });
        expect(response.status).toBe(200);
        expect(response.body.status).toBe(true);
        const saved = await readTask(owner.api, tasks[key]._id);
        expect(saved.startDate, `${key} start date after fixture update`).toBeTruthy();
        expect(saved.DueDate, `${key} due date after fixture update`).toBeTruthy();
    }
    return { project, tasks };
}

async function openChart(page, state, project) {
    await page.goto(`/#/${state.companyId}/project/${project._id}/p?tab=GanttView`);
    await expect(page.locator('.gv__chart .gantt_container')).toBeVisible();
    await expect(page.locator('.gv__count')).toHaveText(/^4 scheduled/);
}

async function reloadChart(page, taskId) {
    await page.reload();
    await expect(page.locator('.gv__chart .gantt_container')).toBeVisible();
    await expect(page.locator('.gv__count')).toHaveText(/^4 scheduled/);
    await expect(barFor(page, taskId)).toBeVisible();
}

async function reloadAndExpectDates(page, api, taskId, expected) {
    await reloadChart(page, taskId);
    const persisted = await readTask(api, taskId);
    expect(calendarDay(persisted.startDate)).toBe(calendarDay(expected.startDate));
    expect(calendarDay(persisted.DueDate)).toBe(calendarDay(expected.DueDate));
}

async function selectDayZoom(page) {
    await page.getByRole('button', { name: 'Days', exact: true }).click();
    await expect(page.locator('.gv__chart .gantt_task_scale .gantt_scale_line').first()).toBeVisible();
}

const barFor = (page, taskId) => page.locator(`.gv__chart .gantt_task_line[task_id="${taskId}"]`);

async function scaleCellWidth(page) {
    const cells = page.locator('.gv__chart .gantt_task_scale .gantt_scale_line').first().locator('.gantt_scale_cell');
    await expect(cells.first()).toBeVisible();
    return cells.first().evaluate((cell) => cell.getBoundingClientRect().width);
}

async function centerTimelineScroll(page) {
    const scrollbar = page.locator('.gv__chart .gantt_hor_scroll').first();
    await scrollbar.evaluate((element) => {
        const maximum = Math.max(0, element.scrollWidth - element.clientWidth);
        element.scrollLeft = Math.round(maximum / 2);
    });
    await waitForRenderFrames(page);
}

async function leftOf(locator) {
    const box = await locator.boundingBox();
    if (!box) throw new Error('Gantt element has no layout box');
    return box.x;
}

async function horizontalScroll(page) {
    const scrollbar = page.locator('.gv__chart .gantt_hor_scroll').first();
    return scrollbar.evaluate((element) => element.scrollLeft);
}

async function timelineMetrics(page) {
    const scrollbar = page.locator('.gv__chart .gantt_hor_scroll').first();
    return scrollbar.evaluate((element) => ({
        scrollLeft: element.scrollLeft,
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth,
    }));
}

async function axisBounds(page) {
    return page.locator('.gv__chart .gantt_task_scale .gantt_scale_line').first().evaluate((row) => {
        const cells = [...row.querySelectorAll('.gantt_scale_cell')];
        const label = (cell) => cell?.getAttribute('aria-label') || cell?.textContent?.trim() || '';
        return { first: label(cells[0]), last: label(cells[cells.length - 1]), count: cells.length };
    });
}

async function panUntilRangeExtends(page, direction) {
    await positionTimelineNearEdge(page, direction);
    const initialAxis = await axisBounds(page);
    const initialTimeline = await timelineMetrics(page);
    const deltaX = direction === 'later' ? -250 : 250;
    const endLabel = direction === 'later' ? initialAxis.last : initialAxis.first;
    let latestAxis = initialAxis;
    let latestTimeline = initialTimeline;

    for (let gesture = 0; gesture < 14; gesture += 1) {
        const point = await findEmptyPanPoint(page, Math.abs(deltaX) + 5);
        await drag(page, point.x, point.y, deltaX);
        await waitForRenderFrames(page);
        latestAxis = await axisBounds(page);
        latestTimeline = await timelineMetrics(page);
        const labelChanged = direction === 'later' ? latestAxis.last !== endLabel : latestAxis.first !== endLabel;
        if (latestTimeline.scrollWidth > initialTimeline.scrollWidth + 2 && labelChanged) {
            return { axis: latestAxis, timeline: latestTimeline };
        }
    }

    throw new Error(`Gantt did not extend its ${direction} date range after 14 blank-space drags; initial axis ${JSON.stringify(initialAxis)}, latest axis ${JSON.stringify(latestAxis)}, initial timeline ${JSON.stringify(initialTimeline)}, latest timeline ${JSON.stringify(latestTimeline)}`);
}

async function positionTimelineNearEdge(page, direction) {
    const scrollbar = page.locator('.gv__chart .gantt_hor_scroll').first();
    await scrollbar.evaluate((element, edge) => {
        const maximum = Math.max(0, element.scrollWidth - element.clientWidth);
        element.scrollLeft = edge === 'later'
            ? Math.max(0, maximum - element.clientWidth - 5)
            : Math.min(maximum, element.clientWidth + 5);
    }, direction);
    await waitForRenderFrames(page);
}

async function waitForRenderFrames(page) {
    await page.evaluate(() => new Promise((resolve) => globalThis.requestAnimationFrame(() => globalThis.requestAnimationFrame(resolve))));
}

async function findEmptyPanPoint(page, maxDelta = 190) {
    const point = await page.locator('.gv__chart .gantt_task').evaluate((timeline, maxDrag) => {
        const timelineRect = timeline.getBoundingClientRect();
        const scaleRect = timeline.querySelector('.gantt_task_scale').getBoundingClientRect();
        const centerX = timelineRect.left + timelineRect.width / 2;
        const xs = [centerX, centerX - 60, centerX + 60];
        for (let y = scaleRect.bottom + 8; y < timelineRect.bottom - 10; y += 7) {
            for (const x of xs) {
                if (x - maxDrag < timelineRect.left + 2 || x + maxDrag > timelineRect.right - 2) continue;
                const target = globalThis.document.elementFromPoint(x, y);
                if (!target || !timeline.contains(target)) continue;
                if (target.closest('.gantt_task_line, .gantt_task_link')) continue;
                return { x: Math.round(x), y: Math.round(y) };
            }
        }
        return null;
    }, maxDelta);
    expect(point, 'a blank point inside the Gantt timeline').not.toBeNull();
    return point;
}

async function drag(page, x, y, deltaX) {
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + deltaX, y, { steps: 8 });
    await page.mouse.up();
}

async function dragBar(page, bar, { part, deltaX }) {
    await expect(bar).toBeVisible();
    let target = bar;
    if (part !== 'body') {
        await bar.hover();
        target = bar.locator(part === 'left' ? '.gantt_task_drag.task_left' : '.gantt_task_drag.task_right');
        await expect(target).toBeVisible();
    }
    const box = await target.boundingBox();
    if (!box) throw new Error(`Gantt ${part} drag handle has no layout box`);
    await drag(page, box.x + box.width / 2, box.y + box.height / 2, deltaX);
}

async function saveAfterDrag(page, taskId, performDrag) {
    const responsePromise = page.waitForResponse((response) => {
        if (response.request().method() !== 'PATCH' || new URL(response.url()).pathname !== '/api/v2/tasks') return false;
        let body;
        try { body = response.request().postDataJSON(); } catch (e) { return false; }
        return body?.action === 'updateDates' && String(body.taskData?._id) === String(taskId);
    }, { timeout: 15000 });
    await performDrag();
    const response = await responsePromise;
    expect(response.status()).toBe(200);
    expect((await response.json()).status).toBe(true);
}

async function expectNoPan(page, anchorBar, anchorX) {
    // Range growth can rebase scrollLeft even when the visible date under the
    // stationary reference bar stays fixed, so compare screen position instead.
    await expect.poll(() => leftOf(anchorBar)).toBeGreaterThanOrEqual(anchorX - 2);
    await expect.poll(() => leftOf(anchorBar)).toBeLessThanOrEqual(anchorX + 2);
}

function watchDateWrites(page) {
    const writes = [];
    page.on('request', (request) => {
        if (request.method() !== 'PATCH' || new URL(request.url()).pathname !== '/api/v2/tasks') return;
        try {
            const body = request.postDataJSON();
            if (body?.action === 'updateDates') writes.push(body);
        } catch (e) { /* Other request bodies are not date writes. */ }
    });
    return writes;
}

async function archiveProject(api, projectId) {
    const response = await api.put(`/api/v1/project/${projectId}`, { updateObject: { deletedStatusKey: 1 } });
    expect(response.status).toBeLessThan(500);
}

const addDays = (date, days) => new Date(date.getTime() + (days * DAY_MS));
const calendarDay = (value) => {
    const date = value && value.seconds ? new Date(value.seconds * 1000) : new Date(value);
    return Math.floor(date.getTime() / DAY_MS);
};
