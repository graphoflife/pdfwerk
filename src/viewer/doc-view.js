// Scrollable document view: page layout, zoom/fit, lazy rendering, navigation, selection
// and pointer dispatch to the active tool.
import { PixelsPerInch } from '../core/pdfjs.js';
import { PageView } from './page-view.js';
import { drawHandles } from '../tools/select.js';

const CSS_UNITS = PixelsPerInch.PDF_TO_CSS_UNITS;
const PAGE_GAP = 12;
const MAX_RENDERED = 14;
export const ZOOM_MIN = 0.1;
export const ZOOM_MAX = 32;

export class DocView extends EventTarget {
  constructor(app, doc) {
    super();
    this.app = app;
    this.doc = doc;
    this.zoom = 1;
    this.fit = app.prefs.get('defaultZoom', 'width');
    this.rotation = 0;
    this.layout = app.prefs.get('layout', 'continuous');
    this.current = 0;
    this.selection = new Set();
    this.selectionPage = -1;
    this.hiddenTypes = null;
    this.pageViews = [];
    this.renderOrder = [];
    this.visible = new Set();
    this.search = null;

    this.el = document.createElement('div');
    this.el.className = 'doc-view';
    this.el.tabIndex = -1;
    this.pagesEl = document.createElement('div');
    this.pagesEl.className = 'pages';
    this.el.append(this.pagesEl);

    this.linkService = this.#makeLinkService();
    this.observer = new IntersectionObserver((entries) => this.#onIntersect(entries), {
      root: this.el, rootMargin: '150% 0px 150% 0px',
    });

    this.el.addEventListener('scroll', () => this.#onScroll(), { passive: true });
    this.el.addEventListener('wheel', (e) => this.#onWheel(e), { passive: false });
    this.el.addEventListener('pointerdown', (e) => this.#onPointerDown(e));
    this.el.addEventListener('pointermove', (e) => this.#onPointerMove(e));
    this.el.addEventListener('pointerup', (e) => this.#onPointerUp(e));
    this.el.addEventListener('pointercancel', (e) => this.#onPointerUp(e, true));
    this.el.addEventListener('dblclick', (e) => this.#onDblClick(e));
    this.el.addEventListener('contextmenu', (e) => this.#onContextMenu(e));
    this.resizeObs = new ResizeObserver(() => {
      if (this.fit) requestAnimationFrame(() => this.applyZoom());
    });
    this.resizeObs.observe(this.el);

    this.onAnnots = (e) => this.#onAnnotationsChanged(e.detail.pages);
    this.onStructure = () => this.rebuild(true);
    doc.addEventListener('annotations', this.onAnnots);
    doc.addEventListener('structure', this.onStructure);
  }

  get tool() {
    return this.app.tools.active;
  }

  // ------------------------------------------------------------ building & layout
  rebuild(keepPosition = false) {
    const cur = Math.min(this.current, this.doc.numPages - 1);
    for (const pv of this.pageViews) {
      this.observer.unobserve(pv.el);
      pv.destroy();
    }
    this.pageViews = this.doc.pages.map((_, i) => new PageView(this, i));
    this.pagesEl.replaceChildren(...this.pageViews.map((pv) => pv.el));
    this.renderOrder = [];
    this.visible.clear();
    this.selection = new Set([...this.selection].filter((id) => this.doc.find(id)));
    this.applyLayoutClass();
    this.applyZoom();
    for (const pv of this.pageViews) this.observer.observe(pv.el);
    if (keepPosition) this.goToPage(Math.max(0, cur), { instant: true });
    this.emit('pages');
    this.emit('selection');
  }

  applyLayoutClass() {
    this.pagesEl.className = `pages layout-${this.layout}`;
    if (this.layout === 'single') {
      this.pageViews.forEach((pv, i) => { pv.el.hidden = i !== this.current; });
    } else {
      this.pageViews.forEach((pv) => { pv.el.hidden = false; });
    }
  }

  setLayout(layout) {
    this.layout = layout;
    this.app.prefs.set('layout', layout);
    const cur = this.current;
    this.applyLayoutClass();
    this.applyZoom();
    this.goToPage(cur, { instant: true });
    this.emit('zoom');
  }

  viewportFor(i, zoom = this.zoom) {
    const info = this.doc.pages[i];
    return info.proxy.getViewport({ scale: zoom * CSS_UNITS, rotation: (info.rotate + this.rotation) % 360 });
  }

  /** Unscaled (zoom 1) CSS size of a page, honouring rotation. */
  pageSize(i) {
    const info = this.doc.pages[i];
    const [x1, y1, x2, y2] = info.view;
    let w = (x2 - x1) * CSS_UNITS * info.userUnit, h = (y2 - y1) * CSS_UNITS * info.userUnit;
    if ((info.rotate + this.rotation) % 180) [w, h] = [h, w];
    return [w, h];
  }

  fitZoom(mode) {
    if (!this.doc.numPages) return 1;
    const style = getComputedStyle(this.el);
    const availW = this.el.clientWidth - 2 * PAGE_GAP - parseFloat(style.paddingLeft || 0) - parseFloat(style.paddingRight || 0);
    const availH = this.el.clientHeight - 2 * PAGE_GAP;
    const [w, h] = this.pageSize(this.current);
    const cols = this.layout === 'two' ? 2 : 1;
    let maxW = w;
    if (mode === 'width') {
      for (let i = 0; i < Math.min(this.doc.numPages, 50); i++) maxW = Math.max(maxW, this.pageSize(i)[0]);
      return Math.max(ZOOM_MIN, (availW - (cols - 1) * PAGE_GAP) / (maxW * cols));
    }
    return Math.max(ZOOM_MIN, Math.min((availW - (cols - 1) * PAGE_GAP) / (w * cols), availH / h));
  }

  setZoom(zoom, { anchor = null, fit = null } = {}) {
    this.fit = fit;
    this.applyZoom(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom)), anchor);
  }

  setFit(mode) {
    this.fit = mode;
    const cur = this.current;
    this.applyZoom();
    this.goToPage(cur, { instant: true });
  }

  zoomBy(factor, anchor = null) {
    this.setZoom(this.zoom * factor, { anchor });
  }

  applyZoom(zoom = null, anchor = null) {
    if (!this.pageViews.length) return;
    if (this.fit) zoom = this.fitZoom(this.fit);
    zoom ??= this.zoom;
    // Keep the document point under the anchor (or the viewport centre) in place.
    const rect = this.el.getBoundingClientRect();
    const ax = anchor ? anchor[0] - rect.left : this.el.clientWidth / 2;
    const ay = anchor ? anchor[1] - rect.top : this.el.clientHeight / 2;
    const pv = this.pageAtClient(rect.left + ax, rect.top + ay) || this.pageViews[this.current];
    let keep = null;
    if (pv?.viewport) {
      const local = pv.clientToLocal(rect.left + ax, rect.top + ay);
      keep = { pv, pt: pv.toPdf(...local) };
    }
    const changed = zoom !== this.zoom;
    this.zoom = zoom;
    for (const p of this.pageViews) p.setViewport(this.viewportFor(p.index));
    if (keep && changed) {
      const [lx, ly] = keep.pv.toScreen(...keep.pt);
      const r = keep.pv.el.getBoundingClientRect();
      this.el.scrollLeft += r.left + lx - (rect.left + ax);
      this.el.scrollTop += r.top + ly - (rect.top + ay);
    }
    this.scheduleRender(changed ? 150 : 0);
    this.emit('zoom');
  }

  rotateView(delta) {
    const cur = this.current;
    this.rotation = (((this.rotation + delta) % 360) + 360) % 360;
    this.applyZoom();
    this.goToPage(cur, { instant: true });
  }

  // ------------------------------------------------------------ rendering
  #onIntersect(entries) {
    for (const e of entries) {
      const pv = this.pageViews[+e.target.dataset.index];
      if (!pv) continue;
      pv.visible = e.isIntersecting;
      if (e.isIntersecting) {
        this.visible.add(pv);
        pv.refreshLayers();
      } else this.visible.delete(pv);
    }
    this.scheduleRender(0);
  }

  scheduleRender(delay = 0) {
    clearTimeout(this.renderTimer);
    this.renderTimer = setTimeout(() => this.#renderLoop(), delay);
  }

  async #renderLoop() {
    if (this.rendering) { this.renderAgain = true; return; }
    this.rendering = true;
    try {
      do {
        this.renderAgain = false;
        const todo = [...this.visible].filter((pv) => !pv.el.hidden && pv.needsRender)
          .sort((a, b) => Math.abs(a.index - this.current) - Math.abs(b.index - this.current));
        for (const pv of todo.slice(0, 2)) {
          await pv.render();
          this.renderOrder = [pv, ...this.renderOrder.filter((p) => p !== pv)];
          this.renderAgain ||= todo.length > 2;
        }
        this.#evict();
      } while (this.renderAgain && !this.destroyed);
    } finally {
      this.rendering = false;
    }
  }

  #evict() {
    const keep = this.renderOrder.filter((pv) => this.visible.has(pv));
    const others = this.renderOrder.filter((pv) => !this.visible.has(pv));
    while (keep.length + others.length > MAX_RENDERED && others.length) others.pop().release();
    this.renderOrder = [...keep, ...others];
  }

  refreshAll() {
    for (const pv of this.pageViews) {
      pv.renderedScale = 0;
      pv.textLayer = null;
      pv.annotationLayer = null;
    }
    this.scheduleRender(0);
  }

  #onAnnotationsChanged(pages) {
    const list = pages ? pages.map((i) => this.pageViews[i]).filter(Boolean) : this.pageViews;
    for (const id of [...this.selection]) if (!this.doc.find(id)) this.selection.delete(id);
    for (const pv of list) {
      if (pv.visible) pv.renderAnnotations();
      else pv.layersStale = true;
    }
    this.emit('selection');
  }

  // ------------------------------------------------------------ navigation
  #onScroll() {
    if (this.scrollRaf) return;
    this.scrollRaf = requestAnimationFrame(() => {
      this.scrollRaf = 0;
      if (this.layout === 'single') return;
      const top = this.el.scrollTop + this.el.clientHeight * 0.3;
      let best = this.current;
      for (const pv of this.pageViews) {
        if (pv.el.offsetTop <= top) best = pv.index;
        else break;
      }
      if (best !== this.current) {
        this.current = best;
        this.emit('page');
      }
    });
  }

  goToPage(i, { instant = false, top = null } = {}) {
    if (!this.pageViews.length) return;
    i = Math.max(0, Math.min(this.doc.numPages - 1, i));
    const pv = this.pageViews[i];
    const changed = i !== this.current;
    this.current = i;
    if (this.layout === 'single') {
      this.applyLayoutClass();
      this.el.scrollTop = 0;
      if (top != null) {
        const [, y] = pv.toScreen(0, top);
        this.el.scrollTop = pv.el.offsetTop + y - 10;
      }
      this.scheduleRender(0);
    } else {
      let y = pv.el.offsetTop - PAGE_GAP;
      if (top != null && pv.viewport) y = pv.el.offsetTop + pv.toScreen(0, top)[1] - 10;
      this.el.scrollTo({ top: y, behavior: instant ? 'instant' : 'auto' });
    }
    if (changed) this.emit('page');
  }

  /** Scroll so that a user-space rectangle on a page is visible. */
  revealRect(i, rect) {
    const pv = this.pageViews[i];
    if (!pv) return;
    if (this.layout === 'single' && i !== this.current) this.goToPage(i, { instant: true });
    const [ax, ay] = pv.toScreen(rect[0], rect[3]);
    const [bx, by] = pv.toScreen(rect[2], rect[1]);
    const top = pv.el.offsetTop + Math.min(ay, by), bottom = pv.el.offsetTop + Math.max(ay, by);
    const left = pv.el.offsetLeft + Math.min(ax, bx), right = pv.el.offsetLeft + Math.max(ax, bx);
    const el = this.el;
    if (top < el.scrollTop + 20 || bottom > el.scrollTop + el.clientHeight - 20) {
      el.scrollTop = Math.max(0, (top + bottom) / 2 - el.clientHeight / 2);
    }
    if (left < el.scrollLeft || right > el.scrollLeft + el.clientWidth) {
      el.scrollLeft = Math.max(0, (left + right) / 2 - el.clientWidth / 2);
    }
  }

  next() { this.goToPage(this.current + (this.layout === 'two' ? 2 : 1)); }
  prev() { this.goToPage(this.current - (this.layout === 'two' ? 2 : 1)); }

  async goToDestination(dest) {
    const pdf = this.doc.pdf;
    try {
      if (typeof dest === 'string') dest = await pdf.getDestination(dest);
      if (!Array.isArray(dest)) return;
      const ref = dest[0];
      const index = typeof ref === 'object' && ref ? await pdf.getPageIndex(ref) : ref;
      let top = null;
      if (dest[1]?.name === 'XYZ' && typeof dest[3] === 'number') top = dest[3];
      else if ((dest[1]?.name === 'FitH' || dest[1]?.name === 'FitBH') && typeof dest[2] === 'number') top = dest[2];
      this.goToPage(index, { top });
    } catch (e) {
      console.warn('Destination not found', e);
    }
  }

  #makeLinkService() {
    const view = this;
    return {
      externalLinkEnabled: true,
      externalLinkTarget: 2,
      externalLinkRel: 'noopener noreferrer nofollow',
      isInPresentationMode: false,
      eventBus: null,
      get pagesCount() { return view.doc.numPages; },
      get page() { return view.current + 1; },
      set page(v) { view.goToPage(v - 1); },
      get rotation() { return view.rotation; },
      addLinkAttributes(link, url) {
        link.href = url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer nofollow';
        link.title = url;
      },
      getDestinationHash: () => '#',
      getAnchorUrl: () => '#',
      setHash() {},
      goToDestination: (dest) => view.goToDestination(dest),
      goToPage: (n) => view.goToPage(n - 1),
      goToXY: (n) => view.goToPage(n - 1),
      executeNamedAction(action) {
        const map = { NextPage: () => view.next(), PrevPage: () => view.prev(), FirstPage: () => view.goToPage(0), LastPage: () => view.goToPage(view.doc.numPages - 1), Print: () => view.app.commands.run('print') };
        map[action]?.();
      },
      executeSetOCGState() {},
    };
  }

  // ------------------------------------------------------------ selection
  select(ids, { add = false, toggle = false } = {}) {
    const list = ids.map((id) => this.doc.find(id)).filter(Boolean);
    if (!add && !toggle) this.selection.clear();
    for (const f of list) {
      if (this.selection.size && f.page !== this.selectionPage) this.selection.clear();
      this.selectionPage = f.page;
      if (toggle && this.selection.has(f.a.id)) this.selection.delete(f.a.id);
      else this.selection.add(f.a.id);
    }
    this.#refreshSelection();
  }

  clearSelection() {
    if (!this.selection.size) return;
    this.selection.clear();
    this.#refreshSelection();
  }

  #refreshSelection() {
    for (const pv of this.pageViews) {
      if (!pv.visible) continue;
      pv.annotG.querySelectorAll('.selected').forEach((n) => n.classList.remove('selected'));
      for (const id of this.selection) pv.annotG.querySelector(`[data-wrap="${CSS.escape(id)}"]`)?.classList.add('selected');
      this.renderHandles(pv);
    }
    this.emit('selection');
  }

  get selectedAnnots() {
    return [...this.selection].map((id) => this.doc.find(id)?.a).filter(Boolean);
  }

  renderHandles(pv) {
    drawHandles(this, pv);
  }

  // ------------------------------------------------------------ pointer dispatch
  pageAtClient(x, y) {
    const el = document.elementFromPoint(x, y)?.closest?.('.page');
    if (el && this.pagesEl.contains(el)) return this.pageViews[+el.dataset.index];
    for (const pv of this.visible) {
      const r = pv.el.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return pv;
    }
    return null;
  }

  makeEvent(e, pv) {
    const local = pv ? pv.clientToLocal(e.clientX, e.clientY) : null;
    const target = e.target;
    const hitId = target?.closest?.('.hit')?.dataset?.id || null;
    const handle = target?.closest?.('.handle')?.dataset?.handle || null;
    return {
      view: this, pv, page: pv?.index ?? -1, raw: e,
      local, pt: pv && local ? pv.toPdf(...local) : null,
      shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey, alt: e.altKey,
      hitId, handle, target,
    };
  }

  #onPointerDown(e) {
    if (e.button === 1) { this.#startPan(e); return; }
    if (e.button !== 0) return;
    this.app.closeMenus?.();
    if (e.target.closest('.text-editor, .note-popup')) return;
    const pv = e.target.closest('.page') ? this.pageViews[+e.target.closest('.page').dataset.index] : null;
    const ev = this.makeEvent(e, pv);
    if (this.app.spaceHand && !e.target.closest('.annotationLayer input, .annotationLayer textarea, .annotationLayer select')) {
      this.#startPan(e);
      return;
    }
    const handled = this.tool?.onPointerDown?.(ev);
    if (handled === 'native') {
      // Native text selection: no pointer capture, just report the release.
      const tool = this.tool;
      const up = (e2) => {
        window.removeEventListener('pointerup', up, true);
        this.pageViews.forEach((p) => p.textDiv.classList.remove('selecting'));
        tool?.onPointerUp?.(this.makeEvent(e2, pv));
      };
      window.addEventListener('pointerup', up, true);
      return;
    }
    if (handled) {
      this.dragPv = pv;
      this.dragging = true;
      try { this.el.setPointerCapture(e.pointerId); } catch { /* noop */ }
      e.preventDefault();
    }
  }

  #onPointerMove(e) {
    if (this.panning) {
      this.el.scrollLeft = this.panning.sl - (e.clientX - this.panning.x);
      this.el.scrollTop = this.panning.st - (e.clientY - this.panning.y);
      return;
    }
    if (this.dragging) {
      this.tool?.onPointerMove?.(this.makeEvent(e, this.dragPv));
      return;
    }
    const pv = e.target.closest?.('.page') ? this.pageViews[+e.target.closest('.page').dataset.index] : null;
    const ev = this.makeEvent(e, pv);
    this.tool?.onHover?.(ev);
    if (pv && ev.pt) this.app.statusbar?.setCoords(ev.pt, pv.index);
  }

  #onPointerUp(e, cancelled = false) {
    if (this.panning) {
      this.panning = null;
      this.el.classList.remove('panning');
      return;
    }
    if (!this.dragging) return;
    this.dragging = false;
    try { this.el.releasePointerCapture(e.pointerId); } catch { /* noop */ }
    const ev = this.makeEvent(e, this.dragPv);
    ev.cancelled = cancelled;
    this.tool?.onPointerUp?.(ev);
    this.dragPv = null;
  }

  startPan(e) { this.#startPan(e); }

  #startPan(e) {
    e.preventDefault();
    this.panning = { x: e.clientX, y: e.clientY, sl: this.el.scrollLeft, st: this.el.scrollTop };
    this.el.classList.add('panning');
    try { this.el.setPointerCapture(e.pointerId); } catch { /* noop */ }
  }

  #onDblClick(e) {
    const pv = e.target.closest('.page') ? this.pageViews[+e.target.closest('.page').dataset.index] : null;
    if (!pv) return;
    this.tool?.onDoubleClick?.(this.makeEvent(e, pv));
  }

  #onContextMenu(e) {
    const pv = e.target.closest('.page') ? this.pageViews[+e.target.closest('.page').dataset.index] : null;
    if (e.target.closest('.text-editor, .note-popup, input, textarea')) return;
    e.preventDefault();
    this.app.showViewContextMenu(this.makeEvent(e, pv), e);
  }

  #onWheel(e) {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0025));
      this.zoomBy(Math.min(1.5, Math.max(0.67, factor)), [e.clientX, e.clientY]);
      return;
    }
    if (this.layout === 'single') {
      const el = this.el;
      const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 2;
      const atTop = el.scrollTop <= 0;
      if (e.deltaY > 0 && atBottom && this.current < this.doc.numPages - 1) { e.preventDefault(); this.#wheelPage(1); }
      else if (e.deltaY < 0 && atTop && this.current > 0) { e.preventDefault(); this.#wheelPage(-1); }
    }
  }

  #wheelPage(d) {
    const now = Date.now();
    if (now - (this.lastWheelPage || 0) < 350) return;
    this.lastWheelPage = now;
    this.goToPage(this.current + d, { instant: true });
    if (d < 0) this.el.scrollTop = this.el.scrollHeight;
  }

  emit(type, detail = {}) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  destroy() {
    this.destroyed = true;
    this.observer.disconnect();
    this.resizeObs.disconnect();
    this.doc.removeEventListener('annotations', this.onAnnots);
    this.doc.removeEventListener('structure', this.onStructure);
    for (const pv of this.pageViews) pv.destroy();
    this.el.remove();
  }
}
