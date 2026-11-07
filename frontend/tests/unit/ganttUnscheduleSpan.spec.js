import { describe, expect, it } from 'vitest';
import { DAY, rememberSpan, spanKey, takeSpan } from '@/views/Projects/GanttView/unscheduleSpan';

function memoryStorage(initial = {}) {
    const data = new Map(Object.entries(initial));
    return {
        data,
        getItem: (key) => (data.has(key) ? data.get(key) : null),
        setItem: (key, value) => data.set(key, String(value)),
        removeItem: (key) => data.delete(key),
    };
}

const throwingStorage = {
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('blocked'); },
    removeItem() { throw new Error('blocked'); },
};

describe('unscheduleSpan', () => {
    it('builds the versioned key', () => {
        expect(spanKey('p1', 't9')).toBe('gantt.span.v1.p1.t9');
    });

    it('round-trips a whole-day span and removes the key after take', () => {
        const storage = memoryStorage();
        rememberSpan(storage, 'p1', 't1', 3 * DAY);
        expect(takeSpan(storage, 'p1', 't1')).toBe(3 * DAY);
        expect(storage.data.has(spanKey('p1', 't1'))).toBe(false);
    });

    it('rounds fractional days to the nearest whole day', () => {
        const storage = memoryStorage();
        rememberSpan(storage, 'p1', 't1', 2.6 * DAY);
        expect(takeSpan(storage, 'p1', 't1')).toBe(3 * DAY);
    });

    it('falls back to one day when the key is missing', () => {
        expect(takeSpan(memoryStorage(), 'p1', 't1')).toBe(DAY);
    });

    it('falls back to one day for garbage stored values', () => {
        const storage = memoryStorage({ [spanKey('p1', 't1')]: 'abc' });
        expect(takeSpan(storage, 'p1', 't1')).toBe(DAY);
    });

    it.each([
        ['NaN', NaN],
        ['Infinity', Infinity],
        ['negative', -2 * DAY],
        ['zero', 0],
    ])('falls back to one day for %s', (_label, ms) => {
        const storage = memoryStorage();
        rememberSpan(storage, 'p1', 't1', ms);
        expect(takeSpan(storage, 'p1', 't1')).toBe(DAY);
    });

    it('never throws when storage throws', () => {
        expect(() => rememberSpan(throwingStorage, 'p1', 't1', 2 * DAY)).not.toThrow();
        expect(takeSpan(throwingStorage, 'p1', 't1')).toBe(DAY);
    });

    it('returns one day for null storage', () => {
        expect(() => rememberSpan(null, 'p1', 't1', 2 * DAY)).not.toThrow();
        expect(takeSpan(null, 'p1', 't1')).toBe(DAY);
    });
});
