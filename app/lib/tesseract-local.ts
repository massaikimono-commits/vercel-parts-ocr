/* eslint-disable @typescript-eslint/no-explicit-any */
import * as Tesseract from "tesseract.js";

const LOCAL_TESSERACT_OPTIONS = {
  workerPath: "/tesseract/worker.min.js",
  corePath: "/tesseract/core",
  langPath: "/tesseract/lang",
  gzip: true,
  workerBlobURL: false,
};

export async function createWorker(
  langs: any = "eng",
  oem: any = 1,
  options: any = {},
  config: any = {}
) {
  return Tesseract.createWorker(
    langs,
    oem,
    {
      ...LOCAL_TESSERACT_OPTIONS,
      ...options,
      // Security invariant: runtime code/data always stay same-origin.
      workerPath: LOCAL_TESSERACT_OPTIONS.workerPath,
      corePath: LOCAL_TESSERACT_OPTIONS.corePath,
      langPath: LOCAL_TESSERACT_OPTIONS.langPath,
      gzip: true,
      workerBlobURL: false,
    },
    config
  );
}

export const PSM = Tesseract.PSM;
export const OEM = Tesseract.OEM;
export const createScheduler = Tesseract.createScheduler;
export const recognize = Tesseract.recognize;
export const setLogging = Tesseract.setLogging;
