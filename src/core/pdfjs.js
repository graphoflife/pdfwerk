// pdf.js bootstrap: worker, runtime asset locations and a loader with password support.
import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

const assets = new URL('./pdfjs/', document.baseURI).href;

export const DOC_OPTIONS = {
  cMapUrl: `${assets}cmaps/`,
  cMapPacked: true,
  standardFontDataUrl: `${assets}standard_fonts/`,
  wasmUrl: `${assets}wasm/`,
  iccUrl: `${assets}iccs/`,
  isEvalSupported: false,
  enableXfa: false,
};

/**
 * Load a document with pdf.js. `askPassword(retry)` resolves to a password or null (cancel).
 */
export async function loadPdfjs(bytes, { askPassword, password } = {}) {
  const task = pdfjsLib.getDocument({ ...DOC_OPTIONS, data: bytes.slice(), password });
  let usedPassword = password;
  task.onPassword = async (update, reason) => {
    const pw = askPassword ? await askPassword(reason === pdfjsLib.PasswordResponses.INCORRECT_PASSWORD) : null;
    if (pw == null) {
      task.destroy();
      return;
    }
    usedPassword = pw;
    update(pw);
  };
  const pdf = await task.promise;
  return { pdf, password: usedPassword };
}

export { pdfjsLib };
export const { AnnotationMode, TextLayer, AnnotationLayer, PixelsPerInch } = pdfjsLib;
