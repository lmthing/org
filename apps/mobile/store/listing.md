# Google Play store listing — org.lmthing.mobile

Source of truth for the listing copy. Keep in sync with what Play actually shows.

## App name (max 30)

lmthing

## Short description (max 80)

Describe what you need. THING builds it, and you use it from your phone.

## Full description (max 4000)

lmthing is a workspace you talk to.

Describe a problem in your own words and THING — the agent at the centre of it — writes the
code, builds the tool and puts it in your workspace. Not a chatbot that suggests what you
could do. Something that does it, and hands you back a thing you can open and use.

WHAT YOU CAN ASK FOR

• A tool for something you actually do. A tracker for a renovation, a reading list, a
  budget for a trip. It gets a database, pages and an interface, built while you watch.
• Research you can keep. THING searches the web, reads what it finds and stores the
  answer in your workspace instead of losing it in a conversation.
• A specialist that sticks around. Teach it about a topic once and it keeps that
  knowledge, so the next question starts where the last one ended.
• Documents, photos and voice notes. Send it a spreadsheet, a picture or a recording and
  it works from those directly.

YOUR WORKSPACE, ON YOUR PHONE

Everything lives in a private workspace that is yours alone. Open it on your phone and
pick up the conversation you started at your desk — same projects, same history, same
tools. What you build stays available offline of the conversation that created it.

TEAMS

Bring people into a shared space with channels, mentions and notifications. Ask THING
something in a channel and everyone sees the answer and the tool it built. Team messages
live in the team's own workspace, not scattered across personal accounts.

BUILT TO BE LEAVEABLE

Connect a GitHub repository and your workspace mirrors itself there continuously. It is
your copy, in your account, and it outlives your use of lmthing. You can ask us to delete
your account at any time and we will not ask you why.

WHAT IT COSTS

A free tier with a monthly allowance, and paid tiers when you need more. Usage is shown
in the app as you go, so you always know where you stand before you spend.

lmthing is under active development and improving quickly. If something is wrong, there
is a report button inside the app that files it directly with us.

---

## Assets

| asset | spec | file |
|---|---|---|
| App icon | 512×512 PNG | `store/icon-512.png` |
| Feature graphic | 1024×500 PNG | `store/feature-graphic.png` |
| Phone screenshots | 2–8, 9:16, ≥1080px per side for promotion eligibility | `store/phone/` |
| 7-inch tablet | 4, **16:9 landscape** 1920×1080 (bounds 320–3840) | `store/tablet-7/` |
| 10-inch tablet | 4, **16:9 landscape** 2560×1440 (bounds 1080–7680) | `store/tablet-10/` |

Video is optional and deliberately not supplied.

The tablet sets are the **same four frames at two resolutions** — captured once at 2560×1440 from the
real app signed into a real workspace (`lmthing.chat`, headless Chrome at 1280×720 CSS × 2), then
downscaled for the 7-inch set, so the two sets cannot drift apart:

| # | Shows |
|---|---|
| `01-ask-anything` | an empty conversation in a project — what the app offers before you type |
| `02-plan-a-trip` | THING answering with a researched itinerary and a rail-pass verdict |
| `03-compare-quotes` | THING comparing two renovation quotes and saying what to ask next |
| `04-your-projects` | the project switcher — one workspace per thing you are doing |

## Links

| field | value |
|---|---|
| Privacy policy | https://lmthing.com/privacy |
| Account deletion | https://lmthing.com/delete-account |
| Support email | support@lmthing.org |
