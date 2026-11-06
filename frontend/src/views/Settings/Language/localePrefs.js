// Language and region preferences.
//
// Regional formatting changes display only. The numeral system is a
// DISPLAY-ONLY transliteration — stored values, ids, and anything sent to the
// API stay Latin digits.

import { reactive, watch } from "vue";
import moment from "moment";
import "moment/locale/th";

export const LOCALES = [
    { code: "en", label: "English", english: "English", dir: "ltr" },
    { code: "hi", label: "हिन्दी", english: "Hindi", dir: "ltr" },
    { code: "ar", label: "العربية", english: "Arabic", dir: "rtl" },
    { code: "spa", label: "Español", english: "Spanish", dir: "ltr" },
    { code: "fr", label: "Français", english: "French", dir: "ltr" },
    { code: "ge", label: "Deutsch", english: "German", dir: "ltr" },
    { code: "ptBr", label: "Português", english: "Portuguese (Brazil)", dir: "ltr" },
    { code: "ja", label: "日本語", english: "Japanese", dir: "ltr" },
    { code: "it", label: "Italiano", english: "Italian", dir: "ltr" },
    { code: "gr", label: "Ελληνικά", english: "Greek", dir: "ltr" },
    { code: "ch", label: "中文", english: "Chinese", dir: "ltr" },
    { code: "ru", label: "Русский", english: "Russian", dir: "ltr" },
    { code: "ko", label: "한국어", english: "Korean", dir: "ltr" },
    { code: "gu", label: "ગુજરાતી", english: "Gujarati", dir: "ltr" },
    { code: "th", label: "ไทย", english: "Thai", dir: "ltr" }
];

export const NUMERAL_SYSTEMS = [
    { key: "latn", sample: "1,25,000.50", digits: "0123456789" },
    { key: "arab", sample: "١٬٢٥٬٠٠٠٫٥٠", digits: "٠١٢٣٤٥٦٧٨٩" },
    { key: "deva", sample: "१,२५,०००.५०", digits: "०१२३४५६७८९" },
    { key: "thai", sample: "๑,๒๕,๐๐๐.๕๐", digits: "๐๑๒๓๔๕๖๗๘๙" }
];

export const DATE_FORMATS = [
    "DD/MM/YYYY", "MM/DD/YYYY", "DD-MM-YYYY", "MM-DD-YYYY", "YYYY/MM/DD", "YYYY-MM-DD", "D MMM YYYY",
    "DD MMM[,] YYYY", "MMMM Do[,] YYYY", "MMMM DD[,] YYYY", "DD MMMM[,] YYYY", "Do MMMM[,] YYYY"
];
export const CALENDARS = ["gregory", "buddhist"];
export const NUMBER_FORMATS = ["1,250,000.50", "1.250.000,50", "1,25,000.50", "1 250 000,50"];
export const WEEK_STARTS = ["monday", "sunday", "saturday"];
export const CURRENCIES = ["USD", "EUR", "GBP", "INR", "JPY", "AUD", "CAD", "AED", "THB"];

const STORAGE_KEY = "ah_locale_prefs";

const DEFAULTS = {
    language: "en",
    numerals: "latn",
    dateFormat: "DD/MM/YYYY",
    calendar: "gregory",
    numberFormat: "1,250,000.50",
    weekStart: "monday",
    currency: "USD"
};

const PREF_KEYS = Object.keys(DEFAULTS);
let workspaceDateFormat = DEFAULTS.dateFormat;

const pickPrefs = (source) => PREF_KEYS.reduce((out, key) => {
    if (source && typeof source[key] === "string" && source[key]) out[key] = source[key];
    return out;
}, {});

const readStored = () => {
    try {
        return JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    } catch (error) {
        return null;
    }
};

const read = () => ({ ...DEFAULTS, ...pickPrefs(readStored()) });

// A copy without an owner predates the stamp and is taken to be the signed-in person's.
const storedCopyOf = (uid) => {
    const stored = readStored();
    if (!stored || (stored.owner && uid && stored.owner !== String(uid))) return null;
    const configured = Array.isArray(stored.configured)
        ? stored.configured.filter((key) => PREF_KEYS.includes(key))
        : PREF_KEYS.filter((key) => Object.prototype.hasOwnProperty.call(stored, key));
    return configured.reduce((copy, key) => {
        if (typeof stored[key] === "string" && stored[key]) copy[key] = stored[key];
        return copy;
    }, {});
};

export const localePrefs = reactive(read());

export const localeOf = (code) => LOCALES.find((locale) => locale.code === code) || LOCALES[0];

export const directionOf = (code) => localeOf(code).dir;

export function hasLocalePreference(key) {
    const stored = readStored();
    if (!stored) return false;
    const configured = Array.isArray(stored.configured)
        ? stored.configured
        : PREF_KEYS.filter((candidate) => Object.prototype.hasOwnProperty.call(stored, candidate));
    return configured.includes(key);
}

export function setWorkspaceDateFormat(format) {
    if (typeof format === "string" && format) workspaceDateFormat = format;
    return workspaceDateFormat;
}

export function effectiveDateFormat() {
    return hasLocalePreference("dateFormat") ? localePrefs.dateFormat : workspaceDateFormat;
}

function configuredPrefsCopy() {
    const stored = readStored();
    if (!stored) return {};
    const configured = Array.isArray(stored.configured)
        ? stored.configured.filter((key) => PREF_KEYS.includes(key))
        : PREF_KEYS.filter((key) => Object.prototype.hasOwnProperty.call(stored, key));
    return configured.reduce((copy, key) => {
        if (typeof localePrefs[key] === "string" && localePrefs[key]) copy[key] = localePrefs[key];
        return copy;
    }, {});
}

export function localeTagOf(code = localePrefs.language) {
    return ({
        spa: "es",
        ge: "de",
        gr: "el",
        ch: "zh",
        ptBr: "pt-BR",
        th: "th-TH"
    })[code] || code || "en";
}

export function applyDirection(code) {
    const dir = directionOf(code);
    if (typeof document === "undefined") return dir;
    document.documentElement.setAttribute("dir", dir);
    document.documentElement.setAttribute("lang", localeTagOf(code));
    return dir;
}

// Display-only: swaps Latin digits for another script's digits. Never call this
// on a value that will be stored, parsed, or sent to the API.
export function toNumerals(text, system) {
    const entry = NUMERAL_SYSTEMS.find((candidate) => candidate.key === (system || localePrefs.numerals));
    if (!entry || entry.key === "latn") return String(text === undefined || text === null ? "" : text);
    return String(text).replace(/[0-9]/g, (digit) => entry.digits[Number(digit)]);
}

const GROUPING = {
    "1,250,000.50": { group: ",", decimal: ".", indian: false, spacing: false },
    "1.250.000,50": { group: ".", decimal: ",", indian: false, spacing: false },
    "1,25,000.50": { group: ",", decimal: ".", indian: true, spacing: false },
    "1 250 000,50": { group: " ", decimal: ",", indian: false, spacing: true }
};

function groupDigits(whole, style) {
    if (!style.indian) return whole.replace(/\B(?=(\d{3})+(?!\d))/g, style.group);
    if (whole.length <= 3) return whole;
    const head = whole.slice(0, -3);
    return `${head.replace(/\B(?=(\d{2})+(?!\d))/g, style.group)}${style.group}${whole.slice(-3)}`;
}

export function formatNumber(value, prefs = localePrefs) {
    const number = Number(value);
    if (!Number.isFinite(number)) return "";
    const style = GROUPING[prefs.numberFormat] || GROUPING["1,250,000.50"];
    const [whole, fraction = ""] = Math.abs(number).toFixed(2).split(".");
    const body = `${groupDigits(whole, style)}${style.decimal}${fraction}`;
    return toNumerals(`${number < 0 ? "-" : ""}${body}`, prefs.numerals);
}

export function formatDisplayDate(value, pattern, prefs = localePrefs) {
    const dateOnly = typeof value === "string" && /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    const date = value instanceof Date
        ? value
        : (dateOnly ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3])) : new Date(value));
    if (Number.isNaN(date.getTime())) return "";
    const locale = localeTagOf(prefs.language);
    const selectedPattern = pattern || (prefs === localePrefs ? effectiveDateFormat() : (prefs.dateFormat || DEFAULTS.dateFormat));
    const year = date.getFullYear() + (prefs.calendar === "buddhist" ? 543 : 0);
    const pad = (value) => String(value).padStart(2, "0");
    const datePart = (options, type) => new Intl.DateTimeFormat(locale, options).formatToParts(date).find((part) => part.type === type)?.value || "";
    const values = {
        YYYY: String(year),
        YY: String(year).slice(-2),
        MMMM: datePart({ month: "long" }, "month"),
        MMM: datePart({ month: "short" }, "month"),
        MM: pad(date.getMonth() + 1),
        M: String(date.getMonth() + 1),
        DD: pad(date.getDate()),
        Do: String(date.getDate()),
        D: String(date.getDate()),
        dddd: datePart({ weekday: "long" }, "weekday"),
        ddd: datePart({ weekday: "short" }, "weekday"),
        dd: datePart({ weekday: "narrow" }, "weekday"),
        d: String(date.getDay()),
        HH: pad(date.getHours()),
        H: String(date.getHours()),
        hh: pad((date.getHours() % 12) || 12),
        h: String((date.getHours() % 12) || 12),
        mm: pad(date.getMinutes()),
        m: String(date.getMinutes()),
        ss: pad(date.getSeconds()),
        s: String(date.getSeconds()),
        A: datePart({ hour: "numeric", hour12: true }, "dayPeriod"),
        a: datePart({ hour: "numeric", hour12: true }, "dayPeriod").toLowerCase()
    };
    const macro = (options) => new Intl.DateTimeFormat(locale, {
        ...options,
        calendar: prefs.calendar || "gregory",
        numberingSystem: "latn"
    }).format(date);
    const baseDatePattern = prefs === localePrefs ? effectiveDateFormat() : (prefs.dateFormat || DEFAULTS.dateFormat);
    const expandedPattern = String(selectedPattern)
        .replace(/LTS|LLLL|LLL|LL|LT/g, (macroToken) => `\uE000${macroToken}\uE000`)
        .replace(/(^|[^A-Za-z])L(?=$|[^A-Za-z])/g, (...matches) => `${matches[1]}${baseDatePattern}`);
    const tokens = /\[[^\]]*\]|YYYY|YY|MMMM|MMM|MM|M|DD|Do|D|dddd|ddd|dd|d|HH|H|hh|h|mm|m|ss|s|A|a/g;
    const tokenFormatted = expandedPattern.replace(tokens, (token) => (
        token.startsWith("[") ? token.slice(1, -1) : (values[token] ?? token)
    ));
    const formatted = tokenFormatted.replace(/\uE000(LTS|LLLL|LLL|LL|LT)\uE000/g, (_match, key) => {
        const dateTimeOptions = {
            LL: { dateStyle: "medium" },
            LLL: { dateStyle: "medium", timeStyle: "short" },
            LLLL: { dateStyle: "full", timeStyle: "short" },
            LT: { timeStyle: "short" },
            LTS: { timeStyle: "medium" }
        }[key];
        return macro(dateTimeOptions);
    });
    return toNumerals(formatted, prefs.numerals);
}

export function formatDate(value, prefs = localePrefs) {
    return formatDisplayDate(value, prefs === localePrefs ? effectiveDateFormat() : prefs.dateFormat, prefs);
}

export function formatRelativeTime(value, withoutSuffix = false, prefs = localePrefs) {
    if (value === null || value === undefined || value === "") return "";
    const date = moment(value);
    if (!date.isValid()) return "";
    const language = localeTagOf(prefs.language).toLowerCase().startsWith("th") ? "th" : "en";
    return toNumerals(date.locale(language).fromNow(withoutSuffix), prefs.numerals);
}

export function formatDisplayNumber(value, prefs = localePrefs, options = {}) {
    const number = Number(value);
    if (!Number.isFinite(number)) return "";
    const style = GROUPING[prefs.numberFormat] || GROUPING["1,250,000.50"];
    const maximum = Math.max(0, Math.min(20, Number.isInteger(options.maximumFractionDigits) ? options.maximumFractionDigits : 2));
    const minimum = Math.max(0, Math.min(maximum, Number.isInteger(options.minimumFractionDigits) ? options.minimumFractionDigits : 0));
    const rounded = Math.abs(number).toFixed(maximum);
    const [rawWhole, rawFraction = ""] = rounded.split(".");
    const fraction = rawFraction.slice(0, Math.max(minimum, rawFraction.replace(/0+$/, "").length)).padEnd(minimum, "0");
    const body = groupDigits(rawWhole, style) + (fraction ? style.decimal + fraction : "");
    return toNumerals((number < 0 ? "-" : "") + body, prefs.numerals);
}

export function formatCurrencyCode(value, currencyCode, prefs = localePrefs, options = {}) {
    if (value === null || value === undefined || value === "") return "";
    const number = Number(value);
    if (!Number.isFinite(number)) return "";
    const currency = String(currencyCode || "").toUpperCase();
    let formatter;
    try {
        formatter = new Intl.NumberFormat(localeTagOf(prefs.language), { style: "currency", currency, ...options });
    } catch (error) {
        const numberOptions = {
            maximumFractionDigits: Number.isInteger(options.maximumFractionDigits) ? options.maximumFractionDigits : 2,
            minimumFractionDigits: Number.isInteger(options.minimumFractionDigits) ? options.minimumFractionDigits : 0
        };
        return `${currencyCode} ${formatDisplayNumber(number, prefs, numberOptions)}`;
    }
    const parts = formatter.formatToParts(number);
    const numericPart = (part) => ["integer", "group", "decimal", "fraction"].includes(part.type);
    const first = parts.findIndex(numericPart);
    let last = first;
    for (let index = first + 1; index < parts.length && numericPart(parts[index]); index += 1) last = index;
    const { minimumFractionDigits, maximumFractionDigits } = formatter.resolvedOptions();
    const amount = formatDisplayNumber(Math.abs(number), prefs, { minimumFractionDigits, maximumFractionDigits });
    return parts.slice(0, first).map((part) => part.value).join("") + amount + parts.slice(last + 1).map((part) => part.value).join("");
}

export function formatCurrency(value, prefs = localePrefs) {
    const currency = CURRENCIES.includes(prefs.currency) ? prefs.currency : "USD";
    return formatCurrencyCode(value, currency, prefs);
}

export function savePrefs(patch) {
    const existing = readStored();
    const configured = new Set(Array.isArray(existing?.configured)
        ? existing.configured.filter((key) => PREF_KEYS.includes(key))
        : PREF_KEYS.filter((key) => Object.prototype.hasOwnProperty.call(existing || {}, key)));
    Object.keys(patch || {}).filter((key) => PREF_KEYS.includes(key)).forEach((key) => configured.add(key));
    Object.assign(localePrefs, patch || {});
    try {
        const owner = localStorage.getItem("userId") || undefined;
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...localePrefs, owner, configured: [...configured] }));
    } catch (error) {
        // A blocked storage quota must not stop the setting from taking effect.
    }
    applyDirection(localePrefs.language);
    return { ...localePrefs };
}

watch(() => localePrefs.language, (code) => applyDirection(code));

export function bootLocaleDirection() {
    const stored = read();
    const language = localStorage.getItem("language") || stored.language;
    Object.assign(localePrefs, stored, { language });
    return applyDirection(language);
}

// The account's copy wins on every device; with none, this browser's copy is returned so the
// caller can send it up once. The profile's languageCode beats the copy's language because
// My Settings changes only languageCode.
export function adoptAccountPrefs(user = {}) {
    const fromAccount = pickPrefs(user.localePreferences);
    const language = user.languageCode || fromAccount.language || "";
    const withLanguage = language ? { language } : {};
    if (Object.keys(fromAccount).length) {
        try {
            localStorage.removeItem(STORAGE_KEY);
        } catch (error) {
            // A blocked storage quota must not stop account preferences taking effect.
        }
        Object.assign(localePrefs, DEFAULTS);
        savePrefs({ ...fromAccount, ...withLanguage });
        return { language, upload: null };
    }
    const local = storedCopyOf(user._id || localStorage.getItem("userId"));
    if (!local) {
        forgetLocalePrefs();
        Object.assign(localePrefs, withLanguage);
        applyDirection(localePrefs.language);
        return { language, upload: null };
    }
    savePrefs({ ...local, ...withLanguage });
    return { language, upload: configuredPrefsCopy() };
}

export function forgetLocalePrefs() {
    try {
        localStorage.removeItem(STORAGE_KEY);
    } catch (error) {
        return;
    }
    workspaceDateFormat = DEFAULTS.dateFormat;
    Object.assign(localePrefs, DEFAULTS, { language: localePrefs.language });
}
