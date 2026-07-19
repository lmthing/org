---
id: research
output:
  answer: string
  sources: array
dependsOn: []
optional: false
goal: false
role: explore
functions:
  - webSearch
  - webFetch
---

Research the answer to `query` on the live web. Call webSearch(query) then webFetch the top result's url, and resolve a concise answer grounded ONLY in what you read, with sources. Code:
const s = await webSearch(String(query), { depth: 'basic', maxResults: 4 });
const top = (s.results || [])[0];
const page = top ? await webFetch(top.url, { format: 'markdown' }) : { content: '' };
currentTask.resolve({ answer: 'a concise answer grounded in what you read', sources: (s.results || []).slice(0,3).map(function(r){ return { title: r.title, url: r.url }; }) });