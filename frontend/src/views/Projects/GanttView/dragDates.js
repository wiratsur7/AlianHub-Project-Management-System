const toDate = (value) => {
    if (value === null || value === undefined || value === '') return null;
    if (!(value instanceof Date) && typeof value !== 'string' && typeof value !== 'number') return null;
    const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
};

/* Gregorian day ordinal from local date parts, so a local day remains one step across DST. */
const localDayOrdinal = (date) => {
    const month = date.getMonth() + 1;
    let year = date.getFullYear() - (month <= 2 ? 1 : 0);
    const era = Math.floor(year / 400);
    const yearOfEra = year - era * 400;
    const shiftedMonth = month + (month > 2 ? -3 : 9);
    const dayOfYear = Math.floor((153 * shiftedMonth + 2) / 5) + date.getDate() - 1;
    const dayOfEra = yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
    return era * 146097 + dayOfEra;
};

const addCalendarDays = (value, days) => {
    const date = toDate(value);
    if (!date || !Number.isInteger(days)) return null;
    date.setDate(date.getDate() + days);
    return Number.isNaN(date.getTime()) ? null : date;
};

const sameInstant = (left, right) => left.getTime() === right.getTime();

/**
 * Map a DHTMLX drag result back to the stored task-date convention.
 * Body moves translate the stored interval by local calendar days, preserving
 * each endpoint's own time. Resizes update only the edge DHTMLX changed.
 */
export function datesForGanttDrag({ mode, dragModes, original, dragged, stored } = {}) {
    if (!original || !dragged || !stored || !dragModes) return null;

    const originalStart = toDate(original.start_date);
    const originalEnd = toDate(original.end_date);
    const draggedStart = toDate(dragged.start_date);
    const draggedEnd = toDate(dragged.end_date);
    const storedStart = toDate(stored.startDate);
    const storedEnd = toDate(stored.DueDate);
    if (!originalStart || !originalEnd || !draggedStart || !draggedEnd || !storedStart || !storedEnd) return null;

    if (dragModes.move !== undefined && mode === dragModes.move) {
        const days = localDayOrdinal(draggedStart) - localDayOrdinal(originalStart);
        if (!Number.isInteger(days) || days === 0) return null;

        const startDate = addCalendarDays(storedStart, days);
        const DueDate = addCalendarDays(storedEnd, days);
        return startDate && DueDate ? { startDate, DueDate } : null;
    }

    if (dragModes.resize !== undefined && mode === dragModes.resize) {
        if (!sameInstant(originalStart, draggedStart)) {
            if (sameInstant(storedStart, draggedStart)) return null;
            return { startDate: draggedStart, DueDate: stored.DueDate };
        }
        if (!sameInstant(originalEnd, draggedEnd)) {
            if (sameInstant(storedEnd, draggedEnd)) return null;
            return { startDate: stored.startDate, DueDate: draggedEnd };
        }
    }

    return null;
}
