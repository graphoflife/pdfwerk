// Small wrapper around localStorage (fails soft in private mode).
const KEY = 'pdfwerk.prefs.v1';

export class Prefs extends EventTarget {
  constructor() {
    super();
    try {
      this.data = JSON.parse(localStorage.getItem(KEY) || '{}');
    } catch {
      this.data = {};
    }
  }

  get(key, fallback) {
    return key in this.data ? this.data[key] : fallback;
  }

  set(key, value) {
    this.data[key] = value;
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch {
      /* storage full or unavailable */
    }
    this.dispatchEvent(new CustomEvent('change', { detail: { key, value } }));
  }
}
