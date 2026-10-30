// One rendered page: canvas (pdf.js), text layer, form/link layer and our SVG overlay.
import { TextLayer, AnnotationLayer, AnnotationMode } from '../core/pdfjs.js';
import { svgEl, renderAnnotation } from './svg.js';

const MAX_CANVAS_PIXELS = 16_777_216;

export class PageView {
  constructor(view, index) {
    this.view = view;
    this.index = index;
    this.viewport = null;
    this.renderedScale = 0;
    this.renderedRotation = null;
    this.renderTask = null;
    this.state = 'idle'; // idle | queued | rendering | done
    this.textLayer = null;
    this.annotationLayer = null;
    this.drafts = new Map();
    this.hiddenText = new Set();
    this.preview = null;

    const el = (this.el = document.createElement('div'));
    el.className = 'page';
    el.dataset.index = index;

    this.canvasWrap = document.createElement('div');
    this.canvasWrap.className = 'canvas-wrap';
    this.canvas = null;

    this.textDiv = document.createElement('div');
    this.textDiv.className = 'textLayer';
    this.textDiv.addEventListener('pointerdown', () => this.textDiv.classList.add('selecting'));

    this.formDiv = document.createElement('div');
    this.formDiv.className = 'annotationLayer';

    this.blendSvg = svgEl('svg', { class: 'blend-layer' });
    this.blendG = svgEl('g');
    this.blendSvg.append(this.blendG);

    this.svg = svgEl('svg', { class: 'overlay' });
    this.pageG = svgEl('g', { class: 'page-space' });
    this.searchG = svgEl('g', { class: 'search-hits' });
    this.annotG = svgEl('g', { class: 'annots' });
    this.previewG = svgEl('g', { class: 'preview' });
    this.pageG.append(this.searchG, this.annotG, this.previewG);
    this.handlesG = svgEl('g', { class: 'handles' });
    this.svg.append(this.pageG, this.handlesG);

    const label = document.createElement('div');
    label.className = 'page-loading';
    this.loadingEl = label;

    el.append(this.canvasWrap, this.textDiv, this.formDiv, this.blendSvg, this.svg, label);
  }

  get doc() {
    return this.view.doc;
  }

  get proxy() {
    return this.doc.pages[this.index].proxy;
  }

  get scale() {
    return this.viewport?.scale || 1;
  }

  setViewport(viewport) {
    this.viewport = viewport;
    const { width, height } = viewport;
    const s = this.el.style;
    s.width = `${Math.floor(width)}px`;
    s.height = `${Math.floor(height)}px`;
    s.setProperty('--scale-factor', viewport.scale);
    s.setProperty('--user-unit', this.doc.pages[this.index].userUnit || 1);
    s.setProperty('--total-scale-factor', 'calc(var(--scale-factor) * var(--user-unit))');
    s.setProperty('--scale-round-x', '1px');
    s.setProperty('--scale-round-y', '1px');
    for (const svg of [this.svg, this.blendSvg]) {
      svg.setAttribute('width', width);
      svg.setAttribute('height', height);
      svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    }
    const [a, b, c, d, e, f] = viewport.transform;
    const m = `matrix(${a} ${b} ${c} ${d} ${e} ${f})`;
    this.pageG.setAttribute('transform', m);
    this.blendG.setAttribute('transform', m);
    this.layersStale = true;
    if (this.visible) this.refreshLayers();
  }

  /** Bring text/form layers and the overlay in line with the current viewport. */
  refreshLayers() {
    if (!this.layersStale || !this.viewport) return;
    this.layersStale = false;
    const viewport = this.viewport;
    if (this.textLayer) this.textLayer.update({ viewport });
    if (this.annotationLayer) this.annotationLayer.update({ viewport: viewport.clone({ dontFlip: true }) });
    this.renderAnnotations();
    this.view.search?.renderPage(this);
  }

  get needsRender() {
    return this.state !== 'rendering' && (this.renderedScale !== this.viewport.scale || this.renderedRotation !== this.viewport.rotation || !this.canvas);
  }

  /** Render the page bitmap and the text/form layers. */
  async render() {
    const viewport = this.viewport;
    const page = this.proxy;
    if (!page || !viewport) return;
    this.state = 'rendering';
    const dpr = window.devicePixelRatio || 1;
    let sx = dpr;
    const pixels = viewport.width * viewport.height * sx * sx;
    if (pixels > MAX_CANVAS_PIXELS) sx = Math.sqrt(MAX_CANVAS_PIXELS / (viewport.width * viewport.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width * sx);
    canvas.height = Math.floor(viewport.height * sx);
    const ctx = canvas.getContext('2d', { alpha: false });
    try {
      this.renderTask = page.render({
        canvas,
        canvasContext: ctx,
        viewport,
        transform: sx !== 1 ? [sx, 0, 0, sx, 0, 0] : null,
        annotationMode: AnnotationMode.ENABLE_FORMS,
        annotationStorage: this.doc.pdf.annotationStorage,
      });
      await this.renderTask.promise;
    } catch (e) {
      this.state = 'idle';
      if (e?.name !== 'RenderingCancelledException') console.error(e);
      return;
    } finally {
      this.renderTask = null;
    }
    if (this.viewport !== viewport) {
      this.state = 'idle';
      return;
    }
    this.canvas?.remove();
    if (this.canvas) this.canvas.width = this.canvas.height = 0;
    this.canvas = canvas;
    this.canvasWrap.append(canvas);
    this.renderedScale = viewport.scale;
    this.renderedRotation = viewport.rotation;
    this.loadingEl.remove();
    this.state = 'done';
    await Promise.all([this.#renderText(viewport), this.#renderForms(viewport)]);
  }

  async #renderText(viewport) {
    if (this.textLayer) {
      this.textLayer.update({ viewport });
      return;
    }
    this.textDiv.replaceChildren();
    const tl = new TextLayer({
      textContentSource: this.proxy.streamTextContent({ includeMarkedContent: true, disableNormalization: true }),
      container: this.textDiv,
      viewport,
    });
    this.textLayer = tl;
    try {
      await tl.render();
      const end = document.createElement('div');
      end.className = 'endOfContent';
      this.textDiv.append(end);
    } catch (e) {
      if (e?.name !== 'AbortException') console.warn(e);
    }
  }

  async #renderForms(viewport) {
    const vp = viewport.clone({ dontFlip: true });
    if (this.annotationLayer) {
      this.annotationLayer.update({ viewport: vp });
      return;
    }
    const page = this.proxy;
    const pdf = this.doc.pdf;
    try {
      const annotations = await page.getAnnotations({ intent: 'display' });
      if (!annotations.length) return;
      this.doc.fieldObjects ??= await pdf.getFieldObjects();
      this.formDiv.replaceChildren();
      const layer = new AnnotationLayer({
        div: this.formDiv,
        accessibilityManager: null,
        annotationCanvasMap: null,
        annotationEditorUIManager: null,
        annotationStorage: pdf.annotationStorage,
        page,
        viewport: vp,
        structTreeLayer: null,
        commentManager: null,
        linkService: this.view.linkService,
      });
      this.annotationLayer = layer;
      await layer.render({
        annotations,
        imageResourcesPath: '',
        renderForms: true,
        downloadManager: null,
        enableComment: false,
        enableScripting: false,
        hasJSActions: false,
        fieldObjects: this.doc.fieldObjects,
        // older signature compatibility
        viewport: vp, div: this.formDiv, page, linkService: this.view.linkService, annotationStorage: pdf.annotationStorage,
      });
    } catch (e) {
      console.warn('Form layer failed', e);
    }
  }

  cancel() {
    this.renderTask?.cancel();
    this.renderTask = null;
    if (this.state === 'rendering' || this.state === 'queued') this.state = 'idle';
  }

  /** Free the bitmap (keeps size) to bound memory for far-away pages. */
  release() {
    this.cancel();
    if (this.canvas) {
      this.canvas.width = this.canvas.height = 0;
      this.canvas.remove();
      this.canvas = null;
    }
    this.renderedScale = 0;
    this.state = 'idle';
    if (!this.loadingEl.isConnected) this.el.append(this.loadingEl);
  }

  destroy() {
    this.release();
    this.textLayer?.cancel();
    this.el.remove();
  }

  // ------------------------------------------------------------ overlay
  get annots() {
    return this.doc.annots[this.index] || [];
  }

  /** Re-render all annotation graphics on this page. */
  renderAnnotations() {
    if (!this.viewport) return;
    this.annotG.replaceChildren();
    this.blendG.replaceChildren();
    const hidden = this.view.hiddenTypes;
    for (const a0 of this.annots) {
      const a = this.drafts.get(a0.id) || a0;
      if (hidden && (hidden.has(a.type) || hidden.has('*'))) continue;
      this.#appendAnnot(a);
    }
    this.view.renderHandles(this);
  }

  #appendAnnot(a) {
    const { visual, hit, blend } = renderAnnotation(a, this.doc.images, { scale: this.scale, hideText: this.hiddenText.has(a.id) });
    const wrap = svgEl('g', { 'data-wrap': a.id });
    if (blend) {
      this.blendG.append(visual);
    } else {
      wrap.append(visual);
    }
    if (hit) wrap.append(hit);
    if (this.view.selection.has(a.id)) wrap.classList.add('selected');
    this.annotG.append(wrap);
  }

  /** Temporarily show modified versions (while dragging/resizing). */
  setDrafts(list) {
    this.drafts = new Map(list.map((a) => [a.id, a]));
    this.renderAnnotations();
  }

  clearDrafts() {
    if (!this.drafts.size) return;
    this.drafts.clear();
    this.renderAnnotations();
  }

  /** Visual translate of annotations during a move drag (cheap, no re-render). */
  setMoveOffset(ids, dx, dy) {
    const t = dx || dy ? `translate(${dx} ${dy})` : null;
    for (const id of ids) {
      for (const n of this.svg.querySelectorAll(`[data-wrap="${CSS.escape(id)}"]`)) {
        if (t) n.setAttribute('transform', t); else n.removeAttribute('transform');
      }
      for (const n of this.blendG.querySelectorAll(`[data-id="${CSS.escape(id)}"]`)) {
        if (t) n.setAttribute('transform', t); else n.removeAttribute('transform');
      }
    }
  }

  setPreview(a) {
    this.preview = a;
    this.previewG.replaceChildren();
    if (!a) return;
    const { visual } = renderAnnotation(a, this.doc.images, { scale: this.scale, withHit: false });
    if (a.type === 'highlight') visual.style.mixBlendMode = 'multiply';
    this.previewG.append(visual);
  }

  // ------------------------------------------------------------ coordinates
  /** Client (window) coordinates → page CSS px. */
  clientToLocal(clientX, clientY) {
    const r = this.el.getBoundingClientRect();
    return [clientX - r.left, clientY - r.top];
  }

  toPdf(x, y) {
    return this.viewport.convertToPdfPoint(x, y);
  }

  toScreen(x, y) {
    return this.viewport.convertToViewportPoint(x, y);
  }

  /** Visible page box in user space ([x1,y1,x2,y2]). */
  get viewBox() {
    return this.doc.pages[this.index].view;
  }
}
