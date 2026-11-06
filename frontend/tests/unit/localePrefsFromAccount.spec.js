import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/store/index', () => ({ default: { getters: {} } }));
vi.mock('@/composable', () => ({ useCustomComposable: () => ({}) }));
vi.mock('@/offline', () => ({ clearOffline: vi.fn(), registerReplayer: vi.fn() }));

const STORAGE_KEY = 'ah_locale_prefs';
const SERVER = { language: 'ar', numerals: 'arab', dateFormat: 'YYYY-MM-DD', calendar: 'gregory', numberFormat: '1.250.000,50', weekStart: 'saturday', currency: 'AED' };
const LOCAL = { language: 'fr', numerals: 'latn', dateFormat: 'MM/DD/YYYY', calendar: 'gregory', numberFormat: '1 250 000,50', weekStart: 'sunday', currency: 'EUR' };

const stored = () => JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
const load = async () => {
    vi.resetModules();
    return import('@/views/Settings/Language/localePrefs');
};

describe('language settings follow the person, not the browser', () => {
    beforeEach(() => {
        localStorage.clear();
        document.documentElement.removeAttribute('dir');
        localStorage.setItem('userId', 'user-b');
    });

    it('a new browser takes the account copy, writes it locally and applies direction and numerals', async () => {
        const prefs = await load();
        const result = prefs.adoptAccountPrefs({ _id: 'user-b', languageCode: 'ar', localePreferences: SERVER });

        expect(result).toEqual({ language: 'ar', upload: null });
        expect({ ...prefs.localePrefs }).toEqual(SERVER);
        expect(stored()).toMatchObject(SERVER);
        expect(document.documentElement.getAttribute('dir')).toBe('rtl');
        expect(prefs.formatNumber(1250)).toBe('١.٢٥٠,٠٠');
    });

    it('formats Thai numerals and selectable Buddhist years for display only', async () => {
        const prefs = await load();
        const date = new Date(2026, 8, 4);

        expect(prefs.toNumerals('0123456789', 'thai')).toBe('๐๑๒๓๔๕๖๗๘๙');
        expect(prefs.formatDate(date, { language: 'th', dateFormat: 'DD/MM/YYYY', calendar: 'buddhist', numerals: 'thai' }))
            .toBe('๐๔/๐๙/๒๕๖๙');
        expect(prefs.formatDate(date, { language: 'th', dateFormat: 'DD/MM/YYYY', calendar: 'gregory', numerals: 'latn' }))
            .toBe('04/09/2026');
        expect(prefs.formatDisplayDate(date, 'D MMM YYYY', { language: 'th', calendar: 'buddhist', numerals: 'latn' }))
            .toContain('ก.ย.');
    });

    it('formats Thai numerals with the selected number grouping', async () => {
        const prefs = await load();
        expect(prefs.formatDisplayNumber(1234567.5, {
            numberFormat: '1,25,000.50',
            numerals: 'thai'
        })).toBe('๑๒,๓๔,๕๖๗.๕');
    });

    it('formats THB without converting the input value', async () => {
        const prefs = await load();
        const formatted = prefs.formatCurrency(1425.2, {
            language: 'th',
            currency: 'THB',
            numberFormat: '1,250,000.50',
            numerals: 'latn'
        });

        expect(formatted).toContain('฿');
        expect(formatted).toContain('1,425.20');
        expect(prefs.formatCurrency(-1425.2, {
            language: 'th',
            currency: 'THB',
            numberFormat: '1,250,000.50',
            numerals: 'latn'
        })).toMatch(/-.*1,425\.20/);
        expect(prefs.formatCurrency(1425.2, {
            language: 'th',
            currency: 'JPY',
            numberFormat: '1,250,000.50',
            numerals: 'latn'
        })).toContain('1,425');
        expect(prefs.formatCurrency(1425.2, {
            language: 'th',
            currency: 'JPY',
            numberFormat: '1,250,000.50',
            numerals: 'latn'
        })).not.toContain('.');
        expect(prefs.formatCurrency('not-a-number', { language: 'th', currency: 'THB' })).toBe('');
    });

    it('keeps the workspace date format until a personal date format is chosen', async () => {
        const prefs = await load();
        const date = new Date(2026, 8, 4);
        prefs.setWorkspaceDateFormat('DD-MM-YYYY');

        prefs.savePrefs({ language: 'th' });
        expect(prefs.effectiveDateFormat()).toBe('DD-MM-YYYY');
        expect(prefs.formatDisplayDate(date)).toBe('04-09-2026');

        prefs.savePrefs({ dateFormat: 'MM-DD-YYYY' });
        expect(prefs.effectiveDateFormat()).toBe('MM-DD-YYYY');
    });

    it('treats ISO date-only strings as local calendar dates for display', async () => {
        const prefs = await load();
        expect(prefs.formatDisplayDate('2026-09-04', 'YYYY-MM-DD', {
            language: 'en',
            calendar: 'gregory',
            numerals: 'latn'
        })).toBe('2026-09-04');
    });

    it('localizes relative-time labels and respects the selected numerals', async () => {
        const prefs = await load();
        const options = { language: 'th', calendar: 'gregory', numerals: 'thai' };
        const withSuffix = prefs.formatRelativeTime(Date.now() - 2 * 60 * 60 * 1000, false, options);
        const withoutSuffix = prefs.formatRelativeTime(Date.now() - 2 * 60 * 60 * 1000, true, options);

        expect(withSuffix).toContain('๒ ชั่วโมง');
        expect(withSuffix).toContain('ที่แล้ว');
        expect(withoutSuffix).toContain('๒ ชั่วโมง');
    });

    it('keeps existing regional preferences when the account language changes to Thai', async () => {
        const existing = { language: 'fr', numerals: 'latn', dateFormat: 'MM/DD/YYYY', calendar: 'gregory', numberFormat: '1 250 000,50', weekStart: 'sunday', currency: 'EUR' };
        const prefs = await load();
        const result = prefs.adoptAccountPrefs({
            _id: 'user-b',
            languageCode: 'th',
            localePreferences: existing
        });

        expect(result.language).toBe('th');
        expect(prefs.localePrefs.language).toBe('th');
        expect(prefs.localePrefs.calendar).toBe('gregory');
        expect(prefs.localePrefs.currency).toBe('EUR');
        expect(prefs.localePrefs.numberFormat).toBe(existing.numberFormat);
    });

    it('the account copy wins over what this browser had', async () => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(LOCAL));
        const prefs = await load();
        const result = prefs.adoptAccountPrefs({ _id: 'user-b', languageCode: 'ar', localePreferences: SERVER });

        expect(result.upload).toBeNull();
        expect({ ...prefs.localePrefs }).toEqual(SERVER);
        expect(stored()).toMatchObject(SERVER);
    });

    it('the language saved on the profile wins over a stale language in the copy', async () => {
        const prefs = await load();
        const result = prefs.adoptAccountPrefs({ _id: 'user-b', languageCode: 'ja', localePreferences: SERVER });

        expect(result.language).toBe('ja');
        expect(prefs.localePrefs.language).toBe('ja');
        expect(prefs.localePrefs.numerals).toBe('arab');
        expect(document.documentElement.getAttribute('dir')).toBe('ltr');
    });

    it('fills a partial account copy from the defaults, never from this browser', async () => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(LOCAL));
        const prefs = await load();
        prefs.adoptAccountPrefs({ _id: 'user-b', languageCode: 'en', localePreferences: { currency: 'INR' } });

        expect(prefs.localePrefs.currency).toBe('INR');
        expect(prefs.localePrefs.dateFormat).toBe('DD/MM/YYYY');
        expect(prefs.localePrefs.weekStart).toBe('monday');
    });

    it('with no account copy it keeps this browser\'s settings and hands them back to send up', async () => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(LOCAL));
        const prefs = await load();
        const result = prefs.adoptAccountPrefs({ _id: 'user-b', languageCode: 'fr' });

        expect(result).toEqual({ language: 'fr', upload: LOCAL });
        expect({ ...prefs.localePrefs }).toEqual(LOCAL);
    });

    it('sends nothing up when neither the account nor this browser has settings', async () => {
        const prefs = await load();
        const result = prefs.adoptAccountPrefs({ _id: 'user-b', languageCode: 'en' });

        expect(result.upload).toBeNull();
        expect(stored()).toBeNull();
    });

    it('never adopts or uploads settings this browser saved for someone else', async () => {
        localStorage.setItem('userId', 'user-a');
        const earlier = await load();
        earlier.savePrefs(LOCAL);
        localStorage.setItem('userId', 'user-b');

        const prefs = await load();
        const result = prefs.adoptAccountPrefs({ _id: 'user-b', languageCode: 'en' });

        expect(result.upload).toBeNull();
        expect(prefs.localePrefs.currency).toBe('USD');
        expect(prefs.localePrefs.dateFormat).toBe('DD/MM/YYYY');
    });

    it('keeps the owner stamp out of the settings the page reads and sends', async () => {
        const prefs = await load();
        prefs.savePrefs(LOCAL);

        expect(stored().owner).toBe('user-b');
        const reloaded = await load();
        expect(Object.keys(reloaded.localePrefs).sort()).toEqual(Object.keys(LOCAL).sort());
    });

    it('signing out forgets the settings on this browser', async () => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(LOCAL));
        const prefs = await load();
        prefs.forgetLocalePrefs();

        expect(stored()).toBeNull();
        expect(prefs.localePrefs.currency).toBe('USD');
        expect(prefs.localePrefs.numerals).toBe('latn');
    });
});

describe('signing out', () => {
    it('clears the language settings with the rest of the session', async () => {
        vi.resetModules();
        localStorage.setItem('userId', 'user-a');
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...LOCAL, owner: 'user-a' }));
        const { useAuth } = await import('@/services');
        await useAuth().logOut({ withOutRefresh: true });

        expect(localStorage.getItem('userId')).toBeNull();
        expect(stored()).toBeNull();
    });
});
