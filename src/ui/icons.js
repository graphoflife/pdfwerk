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
};

export function icon(name, size = 18) {
  const node = ICONS[name] || ICONS.Square;
  const svg = createElement(node);
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('icon');
  return svg;
}
