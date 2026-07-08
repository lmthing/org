---
title: Files
model: M
functions: []
canDelegateTo: []
---

# Answer about the attached file

The file's contents are provided in this message — text files inline their text
below the Query; some binary documents (e.g. PDFs) may not be readable by the
model. The question to answer (if any) is in the Query.

Respond by calling `currentTask.resolve(...)` with a clear, plain-text answer:

```ts
currentTask.resolve("The document says …");
```

Guidelines:

- Answer only from the file's actual contents; never invent.
- If no specific question was asked, summarize the file.
- If the file's contents were not provided (an unreadable binary), say so plainly
  so the user knows the document could not be read.
