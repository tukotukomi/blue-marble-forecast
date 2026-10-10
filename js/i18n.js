// Localization: flat-key string tables in weather/strings/*.json, the same
// shape as the portfolio's own strings/ folder. The language choice is stored
// under the portfolio's `lang` key so it carries across tuckermills.com.

export const LANGUAGES = {
  en: { label: 'English', short: 'EN', file: 'en.json', locale: 'en-US', search: 'en' },
  es: { label: 'Español', short: 'ES', file: 'es.json', locale: 'es', search: 'es' },
  'zh-cn': { label: '中文（简体）', short: '中文', file: 'zh-cn.json', locale: 'zh-CN', search: 'zh' },
};
const DEFAULT = 'en';
const KEY = 'lang';

let lang = DEFAULT;
let strings = {};
let fallback = {};

// Time zones where Spanish or Chinese is the main language. Used as a
// location hint when the device language isn't one we support. It's
// private and offline, unlike an IP lookup, which would send the visitor's
// address to a third party.
const ZH_ZONES = /^Asia\/(Shanghai|Chongqing|Harbin|Urumqi|Hong_Kong|Macau|Taipei)$/;
const ES_ZONES = /^(Europe\/Madrid|Atlantic\/Canary|Africa\/Ceuta|America\/(Mexico_City|Cancun|Merida|Monterrey|Matamoros|Chihuahua|Ciudad_Juarez|Ojinaga|Hermosillo|Mazatlan|Bahia_Banderas|Tijuana|Bogota|Lima|Santiago|Punta_Arenas|Caracas|Guayaquil|La_Paz|Asuncion|Montevideo|Argentina\/.+|Buenos_Aires|Cordoba|Mendoza|Guatemala|El_Salvador|Tegucigalpa|Managua|Costa_Rica|Panama|Havana|Santo_Domingo|Puerto_Rico)|Pacific\/(Galapagos|Easter))$/;

export function detectLang() {
  // 1. Explicit link (?lang=es), 2. the visitor's saved choice.
  const param = new URLSearchParams(location.search).get('lang');
  if (param && LANGUAGES[param]) return param;
  try {
    const stored = localStorage.getItem(KEY);
    if (stored && LANGUAGES[stored]) return stored;
  } catch { /* storage blocked */ }
  // 3. Device language preferences, in the order the visitor ranked them.
  for (const l of navigator.languages || [navigator.language]) {
    const low = (l || '').toLowerCase();
    if (low.startsWith('zh')) return 'zh-cn';
    if (low.startsWith('es')) return 'es';
    if (low.startsWith('en')) return 'en';
  }
  // 4. Where the device is, from its time zone.
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  if (ZH_ZONES.test(tz)) return 'zh-cn';
  if (ES_ZONES.test(tz)) return 'es';
  return DEFAULT;
}

async function fetchTable(code) {
  const res = await fetch(new URL(`../strings/${LANGUAGES[code].file}`, import.meta.url));
  if (!res.ok) throw new Error(`Missing strings for ${code}`);
  return res.json();
}

export async function setLang(code, { persist = false } = {}) {
  if (!LANGUAGES[code]) code = DEFAULT;
  if (!Object.keys(fallback).length) fallback = await fetchTable(DEFAULT);
  strings = code === DEFAULT ? fallback : await fetchTable(code).catch(() => fallback);
  lang = code;
  if (persist) { try { localStorage.setItem(KEY, code); } catch { /* storage blocked */ } }
  document.documentElement.lang = LANGUAGES[code].locale;
  return code;
}

export const getLang = () => lang;
export const locale = () => LANGUAGES[lang].locale;
export const searchLang = () => LANGUAGES[lang].search;

// t('now.feels', { t: '72°' }) -> "Feels like 72°". Missing keys fall back to
// English, then to the key itself so gaps are easy to spot.
export function t(key, vars) {
  let s = strings[key] ?? fallback[key] ?? key;
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
  return s;
}

// Static markup: data-i18n (text), data-i18n-html (trusted markup from our own
// string files), data-i18n-attr="aria-label:key;placeholder:key".
export function applyStatic(root = document) {
  root.querySelectorAll('[data-i18n]').forEach(el => {
    const v = t(el.dataset.i18n);
    if (el.hasAttribute('data-i18n-html')) el.innerHTML = v; else el.textContent = v;
  });
  root.querySelectorAll('[data-i18n-attr]').forEach(el => {
    for (const pair of el.dataset.i18nAttr.split(';')) {
      const [attr, key] = pair.split(':').map(s => s.trim());
      if (attr && key) el.setAttribute(attr, t(key));
    }
  });
  document.title = t('app.title');
  document.querySelector('meta[name="description"]')?.setAttribute('content', t('app.description'));
}
