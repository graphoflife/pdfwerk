// Tool registry, per-tool default styles and the Hand/Select tools.
import { Tool, DragShapeTool, LineTool, PolyTool, InkTool, EraserTool, NoteTool, FreeTextTool, PlaceTool } from './draw.js';
import { MarkupTool, TextSelectTool } from './markup.js';
import { SelectionController, hoverCursor } from './select.js';

const RED = [0.86, 0.15, 0.15];
const BLUE = [0.12, 0.35, 0.85];

export const DEFAULT_STYLES = {
  rect: { color: RED, fill: null, opacity: 1, width: 1.5, dash: 'solid' },
  ellipse: { color: RED, fill: null, opacity: 1, width: 1.5, dash: 'solid' },
  line: { color: RED, opacity: 1, width: 1.5, dash: 'solid', startCap: 'None', endCap: 'None' },
  arrow: { color: RED, fill: null, opacity: 1, width: 1.5, dash: 'solid', startCap: 'None', endCap: 'OpenArrow' },
  polyline: { color: RED, opacity: 1, width: 1.5, dash: 'solid', startCap: 'None', endCap: 'None' },
  polygon: { color: RED, fill: null, opacity: 1, width: 1.5, dash: 'solid' },
  cloud: { color: RED, fill: null, opacity: 1, width: 1.5, dash: 'cloudy' },
  ink: { color: BLUE, opacity: 1, width: 2 },
  eraser: { width: 6 },
  typewriter: { textColor: [0, 0, 0], font: { family: 'Helvetica', size: 12, bold: false, italic: false }, color: [0, 0, 0], width: 0, fill: null, align: 'left', opacity: 1 },
  textbox: { textColor: [0, 0, 0], font: { family: 'Helvetica', size: 12, bold: false, italic: false }, color: RED, width: 1, fill: [1, 1, 1], align: 'left', opacity: 1 },
  callout: { textColor: [0, 0, 0], font: { family: 'Helvetica', size: 12, bold: false, italic: false }, color: RED, width: 1, fill: [1, 1, 0.85], align: 'left', opacity: 1, endCap: 'OpenArrow' },
  note: { color: [1, 0.85, 0.2], opacity: 1, width: 1 },
  highlight: { color: [1, 0.92, 0.2], opacity: 1 },
  underline: { color: [0.1, 0.55, 0.15], opacity: 1 },
  strikeout: { color: RED, opacity: 1 },
  squiggly: { color: BLUE, opacity: 1 },
  stamp: { color: RED, opacity: 0.9, width: 0 },
  image: { opacity: 1, width: 0 },
  signature: { opacity: 1, width: 0 },
  distance: { color: BLUE, opacity: 1, width: 1, dash: 'solid', startCap: 'Butt', endCap: 'Butt', font: { size: 9 }, measure: { ratio: 1, unit: 'mm' } },
  perimeter: { color: BLUE, opacity: 1, width: 1, dash: 'solid', startCap: 'None', endCap: 'None', font: { size: 9 }, measure: { ratio: 1, unit: 'mm' } },
  area: { color: BLUE, fill: [0.75, 0.85, 1], opacity: 0.8, width: 1, dash: 'solid', font: { size: 9 }, measure: { ratio: 1, unit: 'mm' } },
  redact: {},
};

export const TOOL_DEFS = [
  { id: 'hand', label: 'Hand', icon: 'Hand', key: 'h', nav: true },
  { id: 'select', label: 'Kommentare auswählen', icon: 'MousePointer2', key: 'v', nav: true },
  { id: 'text', label: 'Text auswählen', icon: 'TextCursor', key: 's', nav: true },
  { id: 'typewriter', label: 'Schreibmaschine', icon: 'Type', key: 't', cls: FreeTextTool, variant: 'typewriter' },
  { id: 'textbox', label: 'Textfeld', icon: 'TextCursorInput', key: 'b', cls: FreeTextTool, variant: 'textbox' },
  { id: 'callout', label: 'Legende', icon: 'MessageSquareQuote', key: 'k', cls: FreeTextTool, variant: 'callout' },
  { id: 'note', label: 'Notiz', icon: 'MessageSquare', key: 'n', cls: NoteTool },
  { id: 'highlight', label: 'Hervorheben', icon: 'Highlighter', key: 'm', cls: MarkupTool, type: 'highlight', sticky: true },
  { id: 'underline', label: 'Unterstreichen', icon: 'Underline', key: 'u', cls: MarkupTool, type: 'underline', sticky: true },
  { id: 'strikeout', label: 'Durchstreichen', icon: 'Strikethrough', key: 'd', cls: MarkupTool, type: 'strikeout', sticky: true },
  { id: 'squiggly', label: 'Wellenlinie', icon: 'Waves', key: 'w', cls: MarkupTool, type: 'squiggly', sticky: true },
  { id: 'rect', label: 'Rechteck', icon: 'Square', key: 'r', cls: DragShapeTool, type: 'rect' },
  { id: 'ellipse', label: 'Ellipse', icon: 'Circle', key: 'e', cls: DragShapeTool, type: 'ellipse' },
  { id: 'line', label: 'Linie', icon: 'Minus', key: 'l', cls: LineTool, type: 'line' },
  { id: 'arrow', label: 'Pfeil', icon: 'MoveUpRight', key: 'a', cls: LineTool, type: 'line' },
  { id: 'polyline', label: 'Polylinie', icon: 'Spline', key: 'p', cls: PolyTool, variant: 'polyline' },
  { id: 'polygon', label: 'Polygon', icon: 'Pentagon', key: 'g', cls: PolyTool, variant: 'polygon' },
  { id: 'cloud', label: 'Wolke', icon: 'Cloud', key: 'c', cls: PolyTool, variant: 'cloud' },
  { id: 'ink', label: 'Freihand', icon: 'PenLine', key: 'f', cls: InkTool, sticky: true },
  { id: 'eraser', label: 'Radierer', icon: 'Eraser', key: 'x', cls: EraserTool, sticky: true },
  { id: 'stamp', label: 'Stempel', icon: 'Stamp', key: 'j', cls: PlaceTool },
  { id: 'image', label: 'Bild', icon: 'Image', key: 'i', cls: PlaceTool },
  { id: 'signature', label: 'Unterschrift', icon: 'Signature', key: 'q', cls: PlaceTool },
  { id: 'distance', label: 'Abstand', icon: 'Ruler', cls: LineTool, type: 'measure' },
  { id: 'perimeter', label: 'Umfang', icon: 'Spline', cls: PolyTool, variant: 'perimeter' },
  { id: 'area', label: 'Fläche', icon: 'LandPlot', cls: PolyTool, variant: 'area' },
  { id: 'redact', label: 'Schwärzung markieren', icon: 'SquareDashed', cls: DragShapeTool, type: 'redact', sticky: true },
];

class HandTool extends Tool {
  get mode() { return 'hand'; }
  get cursor() { return 'grab'; }

  onPointerDown(ev) {
    if (this.app.selCtl.onPointerDown(ev)) return true;
    if (ev.target.closest('.annotationLayer :is(input, textarea, select, button, a, .linkAnnotation, .buttonWidgetAnnotation)')) return false;
    if (ev.target.closest('.page, .pages, .doc-view')) ev.view.startPan(ev.raw);
    return false;
  }

  onPointerMove(ev) { this.app.selCtl.onPointerMove(ev); }
  onPointerUp(ev) { this.app.selCtl.onPointerUp(ev); }
  onHover(ev) { ev.view.pagesEl.style.cursor = hoverCursor(ev) || ''; }
  onDoubleClick(ev) { this.app.editAnnotation(ev.view, ev.pv, ev.hitId); }
  cancel() { this.app.selCtl.cancel(); }
}

class SelectTool extends HandTool {
  get mode() { return 'select'; }
  get cursor() { return 'default'; }

  onPointerDown(ev) {
    return this.app.selCtl.onPointerDown(ev, { marquee: !!ev.pv });
  }
}

export class ToolManager extends EventTarget {
  constructor(app) {
    super();
    this.app = app;
    this.instances = new Map();
    this.defs = new Map(TOOL_DEFS.map((d) => [d.id, d]));
    const saved = app.prefs.get('toolStyles', {});
    this.styles = {};
    for (const [id, s] of Object.entries(DEFAULT_STYLES)) this.styles[id] = { ...structuredClone(s), ...(saved[id] || {}) };
    this.sticky = app.prefs.get('stickyTools', false);
    this.activeId = 'hand';
    this.lastNav = 'hand';
    app.selCtl = new SelectionController(app);
  }

  get(id) {
    let inst = this.instances.get(id);
    if (!inst) {
      const def = this.defs.get(id);
      const Cls = id === 'hand' ? HandTool : id === 'select' ? SelectTool : id === 'text' ? TextSelectTool : def.cls;
      inst = new Cls(this.app, def);
      this.instances.set(id, inst);
    }
    return inst;
  }

  get active() {
    return this.get(this.activeId);
  }

  setTool(id, { payload = null } = {}) {
    if (!this.defs.has(id)) return;
    const prev = this.active;
    if (id === this.activeId && !payload) {
      if (this.defs.get(id).cls === PlaceTool) this.requestPayload(prev);
      return;
    }
    prev.deactivate();
    this.app.selCtl.cancel();
    this.activeId = id;
    if (this.defs.get(id).nav) this.lastNav = id;
    const tool = this.active;
    if (payload) tool.arm(payload);
    this.app.onToolChanged();
    tool.activate();
    this.dispatchEvent(new Event('change'));
  }

  styleFor(id) {
    return this.styles[id] || {};
  }

  setStyle(id, patch) {
    this.styles[id] = { ...this.styles[id], ...structuredClone(patch) };
    const saved = this.app.prefs.get('toolStyles', {});
    saved[id] = this.styles[id];
    this.app.prefs.set('toolStyles', saved);
    this.dispatchEvent(new Event('style'));
  }

  resetStyles() {
    this.styles = structuredClone(DEFAULT_STYLES);
    this.app.prefs.set('toolStyles', {});
    this.dispatchEvent(new Event('style'));
  }

  setSticky(v) {
    this.sticky = v;
    this.app.prefs.set('stickyTools', v);
    this.dispatchEvent(new Event('change'));
  }

  afterCreate(view, ids, tool, { select = true } = {}) {
    if (!this.sticky && !tool.def.sticky) this.setTool(this.lastNav);
    if (select && ids.length) view.select(ids);
  }

  /** Placement tools need something to place: ask the UI for it. */
  requestPayload(tool) {
    const id = tool.def.id;
    if (id === 'stamp') this.app.dialogs.pickStamp();
    else if (id === 'image') this.app.pickImage();
    else if (id === 'signature') this.app.dialogs.signature();
  }
}
