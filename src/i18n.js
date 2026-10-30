// Tiny i18n: German strings are the keys, other languages map them.
import { EN } from './i18n-en.js';

const DICTS = { en: EN };
let lang = 'de';

export function setLang(l) {
  lang = l in DICTS || l === 'de' ? l : 'en';
  document.documentElement.lang = lang;
}

export function getLang() {
  return lang;
}

export function detectLang() {
  const nav = (navigator.language || 'en').slice(0, 2).toLowerCase();
  return nav === 'de' ? 'de' : 'en';
}

export function t(key, params) {
  let s = (lang !== 'de' && DICTS[lang]?.[key]) || key;
  if (params) s = s.replace(/\{(\w+)\}/g, (m, k) => (k in params ? params[k] : m));
  return s;
}

export function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(lang === 'de' ? 'de-DE' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' });
}
