import 'pdfjs-dist/web/pdf_viewer.css';
import './styles.css';
import { App } from './app.js';

const app = new App(document.getElementById('app'));
window.pdfwerk = app; // handy for debugging in the console

// Open files passed via the File Handling API (installed PWA → "Open with").
if ('launchQueue' in window) {
  window.launchQueue.setConsumer(async (params) => {
    for (const handle of params.files || []) app.openFile(await handle.getFile(), handle);
  });
}

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
