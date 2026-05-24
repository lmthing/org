import { analyzeImage } from "./functions/analyzeImage.js";
import { saveRecord } from "./functions/saveRecord.js";
import { loadHistory } from "./functions/loadHistory.js";

export const hostFunctions: Record<string, (...args: unknown[]) => unknown> = {
  analyzeImage: (...a) => analyzeImage(a[0] as string, a[1] as string, a[2] as never),
  saveRecord:   (...a) => saveRecord(a[0] as string, a[1] as never),
  loadHistory:  (...a) => loadHistory(a[0] as never),
};
