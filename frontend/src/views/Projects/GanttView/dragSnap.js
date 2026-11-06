const DAY_MS = 24 * 60 * 60 * 1000;

const toDate = (value) => {
    if (value === null || value === undefined || value === '') return null;
    if (!(value instanceof Date) && typeof value !== 'string' && typeof value !== 'number') return null;
    const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
};

/* setDate keeps the local clock time, so a shifted boundary stays on its own time of day across DST. */
const addCalendarDays = (date, days) => {
    const shifted = new Date(date.getTime());
    shifted.setDate(shifted.getDate() + days);
    return shifted;
};

const shiftBy = (date, days) => (days === 0 ? new Date(date.getTime()) : addCalendarDays(date, days));

const wholeDays = (from, to) => Math.round((to.getTime() - from.getTime()) / DAY_MS);

export function snapDragDates({ mode, dragModes, original, dragged } = {}) {
    const passthrough = () => ({ start_date: toDate(dragged?.start_date), end_date: toDate(dragged?.end_date) });

    const originalStart = toDate(original?.start_date);
    const originalEnd = toDate(original?.end_date);
    const draggedStart = toDate(dragged?.start_date);
    const draggedEnd = toDate(dragged?.end_date);
    if (!originalStart || !originalEnd || !draggedStart || !draggedEnd || !dragModes) return passthrough();

    if (dragModes.move !== undefined && mode === dragModes.move) {
        const days = wholeDays(originalStart, draggedStart);
        return { start_date: shiftBy(originalStart, days), end_date: shiftBy(originalEnd, days) };
    }

    if (dragModes.resize !== undefined && mode === dragModes.resize) {
        const startMoved = draggedStart.getTime() !== originalStart.getTime();
        const endMoved = draggedEnd.getTime() !== originalEnd.getTime();
        let start = shiftBy(originalStart, startMoved ? wholeDays(originalStart, draggedStart) : 0);
        let end = shiftBy(originalEnd, endMoved ? wholeDays(originalEnd, draggedEnd) : 0);

        if (startMoved && !endMoved) {
            const latestStart = addCalendarDays(end, -1);
            if (start.getTime() > latestStart.getTime()) start = latestStart;
        } else {
            const earliestEnd = addCalendarDays(start, 1);
            if (end.getTime() < earliestEnd.getTime()) end = earliestEnd;
        }

        return { start_date: start, end_date: end };
    }

    return passthrough();
}
