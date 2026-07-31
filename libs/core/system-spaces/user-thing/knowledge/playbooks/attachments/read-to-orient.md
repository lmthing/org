---
description: LOAD WHEN substantial files are attached and you are about to ask a specialist to read them. Ask for a SHORT summary plus the specifics you need, never the full text — a whole document dragged into your context does not even survive to your next statement.
---

# Read to ORIENT, not to COPY

Ask the specialist for a SHORT summary plus the handful of concrete specifics you need to speak
credibly about the material ("summarize these, and list the key names, dates and figures"). Do NOT
ask for "every detail" / "the complete text" / "an exhaustive extraction": a whole document dragged
into your context is the one thing you must not do.

It is expensive, it crowds out everything else, and it does NOT survive to your next statement —
**your variables do not persist between statements**, so the giant string you just bound is gone
next turn and you will be left re-inspecting a value you cannot name (`Cannot find name '...'`),
displaying counts and fragments instead of talking to the user.

You do not need the full contents anyway: whoever actually stores the data reads the file
themselves. When the material is destined for the project's data, hand the **attachment id** to
the automator and let IT read the file in full — that is what `attachmentIds` is for.
Carry a summary; pass the id.
