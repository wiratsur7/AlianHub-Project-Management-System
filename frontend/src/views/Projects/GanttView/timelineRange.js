const DAY_MS = 24 * 60 * 60 * 1000;

const isValidDate = (value) => value instanceof Date && Number.isFinite(value.getTime());
const copyDate = (value) => (isValidDate(value) ? new Date(value.getTime()) : null);
const datesOf = (values) => (Array.isArray(values) ? values.filter(isValidDate).map(copyDate) : []);

/* A UTC ordinal built from local calendar fields avoids 23/25-hour DST days. */
const calendarDay = (date) => {
    const value = new Date(0);
    value.setUTCFullYear(date.getFullYear(), date.getMonth(), date.getDate());
    value.setUTCHours(0, 0, 0, 0);
    return value.getTime() / DAY_MS;
};

const timeOfDay = (date) => (((date.getHours() * 60 + date.getMinutes()) * 60 + date.getSeconds()) * 1000) + date.getMilliseconds();

/* Whole local calendar days cover the visible interval while retaining each boundary's clock time. */
const viewportSpanDays = (start, end) => {
    if (!isValidDate(start) || !isValidDate(end) || end.getTime() <= start.getTime()) return 1;
    const span = calendarDay(end) - calendarDay(start) + ((timeOfDay(end) - timeOfDay(start)) / DAY_MS);
    return Math.max(1, Math.ceil(span));
};

const addCalendarDays = (date, days) => {
    const shifted = new Date(date.getTime());
    shifted.setDate(shifted.getDate() + days);
    return shifted;
};

const boundsOf = (dates) => {
    if (!dates.length) return { startDate: null, endDate: null };
    const ordered = [...dates].sort((a, b) => a.getTime() - b.getTime());
    return { startDate: ordered[0], endDate: ordered[ordered.length - 1] };
};

export function initialTimelineRange({ taskDates, viewportStart, viewportEnd } = {}) {
    const taskBounds = boundsOf(datesOf(taskDates));
    if (!taskBounds.startDate) return taskBounds;

    const span = viewportSpanDays(viewportStart, viewportEnd);
    return {
        startDate: addCalendarDays(taskBounds.startDate, -span),
        endDate: addCalendarDays(taskBounds.endDate, span),
    };
}

export function growTimelineRange({ rangeStart, rangeEnd, visibleStart, visibleEnd } = {}) {
    const startDate = copyDate(rangeStart);
    const endDate = copyDate(rangeEnd);
    const unchanged = () => ({ startDate, endDate });

    if (!startDate || !endDate || endDate < startDate) return unchanged();
    if (!isValidDate(visibleStart) || !isValidDate(visibleEnd) || visibleEnd < visibleStart) return unchanged();

    const span = viewportSpanDays(visibleStart, visibleEnd);
    // Strict thresholds make a viewport exactly one span inside a grown boundary stable on retry.
    const nearStart = visibleStart < addCalendarDays(startDate, span);
    const nearEnd = visibleEnd > addCalendarDays(endDate, -span);
    const startAnchor = visibleStart < startDate ? visibleStart : startDate;
    const endAnchor = visibleEnd > endDate ? visibleEnd : endDate;

    return {
        // If the visible edge is already outside the current range, leave a full span before/after it.
        startDate: nearStart ? addCalendarDays(startAnchor, -span) : startDate,
        endDate: nearEnd ? addCalendarDays(endAnchor, span) : endDate,
    };
}

export function includeTimelineDates({ rangeStart, rangeEnd, taskDates } = {}) {
    const dates = [...datesOf([rangeStart, rangeEnd]), ...datesOf(taskDates)];
    return boundsOf(dates);
}
