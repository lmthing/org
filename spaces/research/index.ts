/**
 * Research space — host-function bridge.
 *
 * The CLI driver dynamically imports this module and injects each entry of
 * `hostFunctions` as a QuickJS global. Everything else the agent needs lives
 * in the standard on-disk layout:
 *
 *   agents/<slug>/instruct.md   — agent role + instructions
 *   functions/*.ts              — auto-discovered → DTS overlay + host bridge
 *   components/{view,form}/*.tsx — auto-discovered → DTS overlay
 *   knowledge/<domain>/<field>/<option>.md — auto-loaded
 *   flows/<slug>/index.md + N.Step.md — the tasklist + sink declaration
 *
 * The CLI builds the system prompt from these files via
 * `@lmthing/llm-repl/lib/spaces/index`'s `loadAgent` + `loadFlow` +
 * `buildAgentPrompt`. No agent.ts or system-prompt.ts in the space.
 */

import { webSearch } from "./functions/webSearch.js";
import { fetchPage } from "./functions/fetchPage.js";
import { readPdf } from "./functions/readPdf.js";
import { readDocument } from "./functions/readDocument.js";
import { extractLinks } from "./functions/extractLinks.js";
import { siteMap } from "./functions/siteMap.js";

export const hostFunctions: Record<string, (...args: unknown[]) => unknown> = {
  webSearch: (...a) => webSearch(a[0] as string, a[1] as never),
  fetchPage: (...a) => fetchPage(a[0] as string, a[1] as never),
  readPdf: (...a) => readPdf(a[0] as string, a[1] as never),
  readDocument: (...a) => readDocument(a[0] as string, a[1] as never),
  extractLinks: (...a) => extractLinks(a[0] as string, a[1] as never),
  siteMap: (...a) => siteMap(a[0] as string, a[1] as never),
};
