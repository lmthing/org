How the host extracts an attached document to plain text, and the per-format quirks
you should keep in mind when reasoning over what `readDocument(id)` hands back. Every
supported type is flattened to text — you never see the original layout, styling,
images, or embedded objects, only the words in reading order.
