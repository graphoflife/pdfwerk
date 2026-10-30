// Lucide icons (ISC licence) – imported individually so the bundle stays small.
import {
  createElement, MousePointer2, Hand, TextCursor, TextCursorInput, Type, MessageSquare, MessageSquareQuote,
  Highlighter, Underline, Strikethrough, Waves, Square, Circle, Minus, MoveUpRight, Spline, Pentagon, Cloud,
  PenLine, Eraser, Stamp, Image, Signature, Ruler, LandPlot, SquareDashed, Trash2, RotateCw, RotateCcw,
  FilePlus, FilePlus2, FileMinus, FileOutput, FileInput, Files, Scissors, Crop, Hash, ZoomIn, ZoomOut,
  Maximize, Minimize, Expand, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, ChevronDown, ChevronUp,
  Search, Save, SaveAll, FolderOpen, Printer, Undo2, Redo2, Settings, Keyboard, Info, X, Plus, Bookmark,
  BookmarkPlus, LayoutGrid, PanelLeft, PanelRight, Moon, Sun, Languages, Download, FileText, EyeOff, Eye,
  Copy, ClipboardPaste, Lock, LockOpen, Droplet, Layers, BringToFront, SendToBack, Columns2,
  RectangleVertical, File, FileImage, Images, Github, MessagesSquare, Reply, PenTool, AlignLeft, AlignCenter,
  AlignRight, Bold, Italic, Menu, ListTree, Fullscreen, Monitor, CircleHelp, Check, ArrowUp, ArrowDown,
  CaseSensitive, WholeWord, Pin, ImagePlus, Paintbrush, ShieldCheck, Heading, ScrollText, Ellipsis,
  Shapes, Combine, FileDown, ArrowUpDown, Scaling, StretchHorizontal, Ban, Calendar, FileStack, Pencil,
  Clock, ArrowLeft, SlidersHorizontal,
} from 'lucide';

const ICONS = {
  MousePointer2, Hand, TextCursor, TextCursorInput, Type, MessageSquare, MessageSquareQuote,
  Highlighter, Underline, Strikethrough, Waves, Square, Circle, Minus, MoveUpRight, Spline, Pentagon, Cloud,
  PenLine, Eraser, Stamp, Image, Signature, Ruler, LandPlot, SquareDashed, Trash2, RotateCw, RotateCcw,
  FilePlus, FilePlus2, FileMinus, FileOutput, FileInput, Files, Scissors, Crop, Hash, ZoomIn, ZoomOut,
  Maximize, Minimize, Expand, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, ChevronDown, ChevronUp,
  Search, Save, SaveAll, FolderOpen, Printer, Undo2, Redo2, Settings, Keyboard, Info, X, Plus, Bookmark,
  BookmarkPlus, LayoutGrid, PanelLeft, PanelRight, Moon, Sun, Languages, Download, FileText, EyeOff, Eye,
  Copy, ClipboardPaste, Lock, LockOpen, Droplet, Layers, BringToFront, SendToBack, Columns2,
  RectangleVertical, File, FileImage, Images, Github, MessagesSquare, Reply, PenTool, AlignLeft, AlignCenter,
  AlignRight, Bold, Italic, Menu, ListTree, Fullscreen, Monitor, CircleHelp, Check, ArrowUp, ArrowDown,
  CaseSensitive, WholeWord, Pin, ImagePlus, Paintbrush, ShieldCheck, Heading, ScrollText, Ellipsis,
  Shapes, Combine, FileDown, ArrowUpDown, Scaling, StretchHorizontal, Ban, Calendar, FileStack, Pencil,
  Clock, ArrowLeft, SlidersHorizontal,
};

// Colour families in the style of classic desktop PDF editors: blue for view/document,
// amber for files and notes, red for shapes and destructive actions, green for rotate/markup.
const COLORS = {
  blue: ['Save', 'SaveAll', 'Type', 'TextCursorInput', 'MessageSquareQuote', 'ZoomIn', 'ZoomOut', 'Scaling', 'Expand',
    'StretchHorizontal', 'Search', 'Bookmark', 'BookmarkPlus', 'LayoutGrid', 'Columns2', 'RectangleVertical', 'ScrollText',
    'FileInput', 'FileOutput', 'Files', 'FilePlus', 'FilePlus2', 'FileImage', 'Images', 'Info', 'Droplet', 'Heading', 'Combine',
    'Fullscreen', 'PanelLeft', 'PanelRight', 'MessagesSquare', 'Undo2', 'Redo2', 'ChevronsLeft', 'ChevronsRight', 'ChevronLeft',
    'ChevronRight', 'Hash', 'FileDown', 'Keyboard', 'Clock', 'Languages', 'FileStack', 'CircleHelp', 'Signature', 'FileText'],
  amber: ['FolderOpen', 'MessageSquare', 'Highlighter', 'Hand', 'Pin', 'Lock', 'LockOpen', 'Paintbrush', 'ClipboardPaste',
    'Pencil', 'Stamp', 'Sun'],
  red: ['Square', 'Circle', 'Pentagon', 'Cloud', 'MoveUpRight', 'Minus', 'Spline', 'Strikethrough', 'Trash2', 'FileMinus',
    'Ban', 'SquareDashed', 'Scissors', 'PenLine', 'Eraser', 'Shapes'],
  green: ['RotateCw', 'RotateCcw', 'Underline', 'Waves', 'ShieldCheck', 'Ruler', 'LandPlot', 'ArrowUpDown', 'BringToFront',
    'SendToBack', 'ArrowUp', 'ArrowDown', 'Image', 'ImagePlus', 'Crop', 'Layers'],
};
const COLOR_OF = new Map(Object.entries(COLORS).flatMap(([c, names]) => names.map((n) => [n, c])));

export function icon(name, size = 18) {
  const node = ICONS[name] || ICONS.Square;
  const svg = createElement(node);
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('aria-hidden', 'true');
  if (size >= 26) svg.setAttribute('stroke-width', '1.6');
  svg.classList.add('icon');
  const color = COLOR_OF.get(name);
  if (color) svg.classList.add(`ic-${color}`);
  return svg;
}
