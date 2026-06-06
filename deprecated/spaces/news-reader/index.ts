/**
 * News Reader space — host-function bridge.
 *
 * Exposes host functions for RSS feed parsing, news search, article extraction,
 * source validation, entity extraction, sentiment analysis, and cross-source
 * comparison. All functions run in Node.js and are injected as QuickJS globals.
 */

import { fetchRSS } from "./functions/fetchRSS.js";
import { searchNews } from "./functions/searchNews.js";
import { fetchArticle } from "./functions/fetchArticle.js";
import { extractEntities } from "./functions/extractEntities.js";
import { compareSources } from "./functions/compareSources.js";
import { readOpml } from "./functions/readOpml.js";
import { getDomainInfo } from "./functions/getDomainInfo.js";

export const hostFunctions: Record<string, (...args: unknown[]) => unknown> = {
  fetchRSS:         (...a) => fetchRSS(a[0] as string, a[1] as never),
  searchNews:       (...a) => searchNews(a[0] as string, a[1] as never),
  fetchArticle:     (...a) => fetchArticle(a[0] as string, a[1] as never),
  extractEntities:  (...a) => extractEntities(a[0] as string, a[1] as never),
  compareSources:   (...a) => compareSources(a[0] as string, a[1] as never),
  readOpml:         (...a) => readOpml(a[0] as string),
  getDomainInfo:    (...a) => getDomainInfo(a[0] as string),
};
