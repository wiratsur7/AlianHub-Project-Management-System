import { formatCurrencyCode, formatDisplayDate, formatDisplayNumber, localePrefs } from '@/views/Settings/Language/localePrefs';

/* The server stores a goal's colour as #rrggbb, so the choices are values, not tokens. */
export const GOAL_COLORS = ['#2F3990', '#2f9e7e', '#d98324', '#6b5ce7', '#0EA5E9', '#EC4899', '#14B8A6', '#F97316'];

const prefsFor = (locale) => locale ? { ...localePrefs, language: locale } : localePrefs;

export function formatNumber(value, locale) {
    return formatDisplayNumber(value, prefsFor(locale), { maximumFractionDigits: 2 });
}

function formatMoney(value, code, locale) {
    return formatCurrencyCode(value, code, prefsFor(locale), { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

export function formatAmount(target, value, locale) {
    if (!Number.isFinite(Number(value))) return '';
    if (target.kind === 'currency' && target.currencyCode) return formatMoney(value, target.currencyCode, locale);
    const text = formatNumber(value, locale);
    return target.unit ? `${text} ${target.unit}` : text;
}

export function formatDay(day, locale) {
    const [year, month, date] = String(day || '').split('-').map(Number);
    if (!year || !month || !date) return '';
    return formatDisplayDate(new Date(year, month - 1, date), 'LL', prefsFor(locale));
}

export function formatWhen(stamp, locale) {
    const date = new Date(stamp);
    return stamp && !Number.isNaN(date.getTime()) ? formatDisplayDate(date, 'LLL', prefsFor(locale)) : '';
}

export function periodLabel(goal, t, locale) {
    const start = formatDay(goal.periodStart, locale);
    const end = formatDay(goal.periodEnd, locale);
    if (start && end) return t('Goals.period_range', { start, end });
    if (start) return t('Goals.period_from', { start });
    if (end) return t('Goals.period_until', { end });
    return t('Goals.period_none');
}
