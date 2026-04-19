# MulmoClaude — Product Hunt Launch Strategy

**Owner:** CMO (strategy), Engineering (demo assets), Community (day-of ops)
**Target launch:** Tuesday, one week out — 12:01 AM PT kickoff
**Positioning one-liner:** *Claude Code that produces docs, presentations, spreadsheets, videos, and remembers everything.*
**Core thesis (the story behind the product):** This is the first visible surface of an AI-native operating system. Claude Code is the kernel; MulmoClaude is the shell, the compositor, and the filesystem users actually see.
**Target early adopter (one audience, not four):** Claude Code power users who have already hit the limits of the terminal. Everyone else — productivity users, knowledge workers, AI enthusiasts — is phase 2 and will come via these users, not in parallel to them.

---

## 1. Positioning & Tagline

### Primary tagline (Product Hunt hero line)

> **MulmoClaude — Claude Code that produces docs, presentations, spreadsheets, videos, and remembers everything.**

This one sentence is the whole product. The concrete noun list (docs, presentations, spreadsheets, videos) does the work — a viewer knows in half a second what they're going to get back. "Remembers everything" is the moat. Every surface — hero video, PH headline, tweet #1, gallery captions — must trace back to it. Everything else (parallel sessions, bridges, sandbox, roles, skills, charts) is *evidence*, not the message.

**Drafting rule:** whenever you're tempted to write "artifacts," write the concrete list instead. Abstractions lose upvotes.

### Supporting taglines (A/B candidates for social + hero imagery)

1. *Docs. Presentations. Spreadsheets. Videos. Out of Claude Code. And it remembers.*
2. *Claude Code that produces the things you actually ship — and gets smarter every chat.*
3. *Turn any research paper into a document, a deck, and a narrated video — without opening anything else.*
4. *Run five Claude Code agents in one browser tab. Get documents, decks, and videos back — not text.*

### Category pick

Primary: **Developer Tools** · Secondary: **Artificial Intelligence**
Dev Tools is where our one audience (Claude Code power users) lives. We skip Productivity entirely — chasing two audiences on PH day means landing neither. AI is a defensive tertiary at most.

---

## 2. The One-Sentence Pitch

**MulmoClaude turns Claude Code into a system that produces real documents, presentations, spreadsheets, and narrated videos, runs multiple agents at once, and builds a personal knowledge base from everything you do.**

Three clauses, in the order a user asks them: *What does it make? How fast? Does it get smarter?* Everything else in this plan is supporting evidence.

### The anti-wrapper line (use this whenever "is it just a ChatGPT clone?" shows up)

> **This doesn't call the Claude API. It runs Claude Code directly — your auth, your tools, your files, your environment.**

That distinction is the whole reason the product can do what it does. Repeat it verbatim in the maker post, the HN title, and tweet #1.

---

## 3. Why This Wins on Product Hunt

Product Hunt voters reward three things: **a clear "aha"**, **a short demo**, and **a narrative that isn't another wrapper**. MulmoClaude lands all three:

| Hunt instinct                  | MulmoClaude's answer                                                                                      |
| ------------------------------ | --------------------------------------------------------------------------------------------------------- |
| "Is this just a ChatGPT clone?"| No — it rides on Claude Code (local auth, your filesystem, your tools), not an API wrapper.               |
| "What's the new idea?"         | Visual output + long-term wiki memory + local files as database — Karpathy's KB idea, shipped.            |
| "Can I try it in 60 seconds?"  | One `yarn install && yarn dev`. No signup, no cloud account, no vendor lock-in.                           |
| "Why should I care tomorrow?"  | Every conversation adds to *your* wiki. Skills, todos, and scheduled runs compound.                       |

---

## 4. Key Messages (collapsed from 9 to 5, reordered)

A PH viewer skims for ~10 seconds and remembers one idea. So we drop to **five** messages, in the order a user's brain actually asks the question. Everything else (roles, skills, bridges-as-feature-list, Markdown storage) is supporting evidence — keep in reserve for the comment thread and FAQ, not the hero copy.

### The five (rank-ordered)

1. **Docs, presentations, spreadsheets, videos — not text.** Claude Code answers with **real documents, narrated slide decks, spreadsheets, ECharts dashboards, and AI-generated videos** (MulmoScript / MulmoCast: Gemini image + Veo 3.1 video + audio narration). Not a chat bubble. This is what "multi-modal" actually means — powered by the open GUI Chat Protocol.
2. **Parallel Claude Code, in one browser tab.** Run **many sessions at once** — one generates a video, another refactors code, a third drafts email. Claude Code is no longer single-threaded. *This is the category-defining shot for the hero video.*
3. **It gets smarter every conversation.** A personal wiki grows from every chat — plain Markdown in your workspace, cross-linked and maintained by Claude itself. Karpathy's *LLM Knowledge Bases* idea, shipped. **This is the moat:** every other Claude client starts from zero; MulmoClaude compounds.
4. **Your phone is a Claude Code client.** Bridges to Telegram, Slack, LINE, Discord, WhatsApp, Matrix — same agent, same workspace, same wiki. Fire a task from the subway, see the document (or the video) waiting on your laptop.
5. **Sandboxed, so you can trust it.** Claude Code has filesystem access — that's the whole point and the whole risk. MulmoClaude auto-runs Claude in a **Docker container that only sees your workspace**. SSH keys, `.env` files, home directory: invisible. No configuration, no permissions dialogs. *Reframe AGPL + Docker as "serious enough to be safe," not "complicated."*

### Kept in reserve (don't lead with these — they're comment-thread fuel)

- Roles (General, Office, Guide & Planner, Artist, Tutor, Storyteller, MulmoCaster) — mention only when someone asks *"what can it do?"*
- Skills launcher + SKILL.md scheduling — a Claude-Code-insider wink, save for HN.
- Markdown-as-database / workspace portability — powers the "gets smarter" story; surface only if someone probes on lock-in.
- ECharts, file attachments, DOCX/XLSX/PPTX — individual features, not the pitch.

---

## 5. Product Hunt Listing Copy

### Headline (60 char max)
`MulmoClaude — Docs, decks, spreadsheets, videos from Claude Code`

### Tagline (60 char max)
`Parallel sessions. Personal wiki. Phone bridges. Sandboxed.`

### First comment (the maker post — pinned)

```
Hi Product Hunt 👋

I'm Satoshi Nakajima. I spent eight years at Microsoft working on
operating systems (lead architect on early Windows releases), then
spent the last year obsessing over a single question: **what does an
AI-native OS actually look like?**

I don't think it's ChatGPT. I don't think it's Copilot. I think the
kernel is something like Claude Code — an agent with direct access to
your files, your tools, your environment. Powerful, but living inside
a terminal.

Terminals were the OS shell of 1975. We can do better.

MulmoClaude is my attempt at the **shell for that new kernel**. It
does three things:

**1. Claude replies with real documents, decks, spreadsheets, and videos — not text.**
Documents, spreadsheets, ECharts dashboards, forms, 3D scenes — and
full narrated slide decks and AI-generated videos via the built-in
MulmoScript / MulmoCast engine (Gemini image + Veo 3.1 video +
audio). Drop in a research paper, get back a summary doc, a deck, and
a narrated video. No other tools opened.

**2. It runs many Claude Code agents in parallel, in one browser tab.**
Kick off a video render in one session, refactor code in another,
draft an email in a third. While one is working, you keep working.
Claude Code is no longer single-threaded.

**3. It gets smarter every conversation.**
Every ingested article, every decision, every fact becomes a
cross-linked page in a personal wiki Claude builds and maintains
itself (inspired by @karpathy's *LLM Knowledge Bases* post). It's
all plain Markdown in `~/mulmoclaude/` — git-friendly, portable,
yours. This is the part I'm proudest of: **every other Claude client
starts from zero; this one compounds.**

Two details that matter:

- **Not a wrapper.** This doesn't call the Claude API. It runs the
  actual Claude Code CLI — your auth, your filesystem, your skills,
  your MCP servers. That's why it can do what it does.
- **Sandboxed by default.** Claude runs inside a Docker container
  that only sees your workspace. SSH keys, `.env` files, home
  directory — invisible. Auto-detected on launch, no configuration.

You can also reach the same workspace from Telegram, Slack, LINE,
Discord, WhatsApp, Matrix — same agent, same wiki memory. Fire a
task from the subway, see the result on your laptop.

Open source, AGPL.

If you're already a Claude Code power user who's hit the walls of
the terminal, this is built for you. Would love your honest feedback
— this is the first visible surface of a much bigger thesis about
what computing looks like when AI is the kernel.

— Satoshi
```

### Description / gallery captions (one per screenshot)

Cut from 9 to 6. Each one maps to one of the five key messages (plus the shock demo). No orphans.

1. **The shock demo** — "Drop in a research paper. Out comes a summary document, a slide deck, and a narrated video. No other tools opened." *(Leads the gallery because it's the ‘wait, it does THAT?' moment.)*
2. **Parallel sessions (hero)** — "Three Claude Code sessions running at once, one browser tab. One renders a video, one builds a spreadsheet, one drafts email."
3. **Docs, decks, spreadsheets, videos — not text** — "Claude Code's answer isn't a chat bubble. It's a document, a deck, a spreadsheet, a chart, or a narrated video you can edit and keep."
4. **Compounding wiki** — "Every conversation adds to a personal wiki Claude builds and maintains itself. Cross-linked Markdown. Yours forever."
5. **Phone as a client** — "Message Claude from Telegram, LINE, Slack, WhatsApp. Send a photo from the subway, get a document back on your laptop."
6. **Sandboxed by default** — "Docker auto-detected. Claude only sees your workspace. SSH keys, .env files, home directory — invisible."

---

## 6. Demo Video Plan

Three videos — each serves a different channel. **Always record silent first; add a single-voice narration pass; ship captions.**

### Video A — The 60-second hero (Product Hunt gallery + Twitter/X)

- **Goal:** earn one upvote per viewer. No feature-listing.
- **The single moment we must land:** split-screen with three Claude Code sessions running simultaneously, one of them producing a narrated MulmoCast video from a dropped-in research paper. That shot is the entire pitch in one frame.
- **The shock demo (opener):** drag a real research paper PDF into one session → out comes a **summary document + slide deck + narrated video**. Not a water-cycle explainer. A real artifact people in our target audience would actually want.
- **Structure:**
  - 0:00–0:05 — Cold open: hand drags a PDF (visibly labeled "Attention Is All You Need" or similar) onto the browser. No logo, no title card.
  - 0:05–0:20 — Split-screen snaps to three sessions. Session 1 (largest): the paper → summary doc → deck → MulmoCast narrated video with Veo 3.1 clips. Session 2: a spreadsheet being built from pasted CSV. Session 3: ECharts candlestick appears. **All running at the same time, no cuts, no spinner waits.**
  - 0:20–0:30 — Caption overlay: *"Every conversation makes the next one smarter."* Zoom on the wiki sidebar: a new page appears, cross-linked to two existing ones.
  - 0:30–0:40 — Phone enters frame: a Telegram message to the same workspace → laptop canvas updates live. Caption: *"Your phone is a Claude Code client."*
  - 0:40–0:50 — Docker sandbox banner on screen. Caption: *"Sandboxed. Claude only sees your workspace."*
  - 0:50–0:55 — Anti-wrapper beat. Single white-on-black frame: *"This is not an API wrapper. This is Claude Code — with a shell."*
  - 0:55–1:00 — Logo + github URL + one-line install. **No install command on-screen if we're shipping a hosted demo** (see §10.5); instead, "try it in your browser: demo.mulmoclaude.com".
- **Production notes:** 1080p screen capture, 24fps, no zoom transitions, monospace captions. Music: one royalty-free lo-fi track at 40% — cut it at 0:55. **Non-negotiable:** zero spinner time. Pre-render, splice, don't wait.

### Video B — The 3-minute deep-dive (YouTube + landing page)

- **Goal:** convert a developer watcher into a `git clone` (or a hosted-demo click).
- **Narrative arc:** *What does it make? How fast? Does it get smarter? Can I trust it?* — exactly the order the user's brain asks.
- **Outline:**
  - 0:00–0:20 — Problem framing, in Satoshi's voice: "I worked on Windows for eight years. Claude Code is the kernel of an AI-native OS. But kernels need shells. Here's the shell I wanted."
  - 0:20–0:50 — **Shock demo.** Drop a research paper PDF. Out comes a summary document, a slide deck, and a narrated MulmoCast video. Call out: *the answer isn't text, it's an artifact. Powered by GUI Chat Protocol.*
  - 0:50–1:30 — Open two more sessions in parallel. Kick off another MulmoCast video in one, refactor a real codebase in another. Three artifacts produced simultaneously. Call out: *"one browser tab, many Claude Code workers."*
  - 1:30–2:10 — **The compounding moment.** Ingest two related articles. Show wiki backlinks appearing. Open a fresh session tomorrow's simulated morning and ask a question — Claude answers grounded in the wiki it built itself. Call out: *"every other Claude client starts from zero. This one compounds."*
  - 2:10–2:30 — Bridges. Message from **Telegram** and **LINE**; show desktop canvas updating live. Same memory, same workspace.
  - 2:30–2:50 — Trust layer. Docker sandbox banner. Show Claude being *unable* to read a file outside the workspace. Frame against tools that run Claude directly on `~/`. Anti-wrapper line on-screen.
  - 2:50–3:00 — Open source, AGPL. Hosted demo link + github link.
- **Production notes:** talking-head inset bottom-right for the first 20 seconds, then pure screencast.

### Video C — The 15-second loop (Instagram, LinkedIn, PH gallery motion)

- Single prompt → single rich visual result → fade to logo. Meant to be muted.
- Shoot 3 variants: **(a)** three parallel sessions running at once, **(b)** a full MulmoCast narrated video rendering, **(c)** Telegram-to-canvas round trip. Pick the strongest for PH; post the other two on launch day.

### Filming checklist (applies to all)

- Use a clean workspace (fresh `~/mulmoclaude/`) so the file tree isn't cluttered.
- Record at 1920×1080 minimum; export H.264 at 8 Mbps.
- Pre-compose all prompts in a text file — don't let live-typing slow the pace. Paste and hit send.
- Do a dry run with the exact network Claude will hit. Agent latency is the #1 demo killer.
- If a plugin takes >8s to render, **cut the wait** — PH viewers don't forgive dead air.

---

## 7. Launch Week Timeline (T = launch day)

### T-14 to T-8 — Asset build

- [ ] Finalize hero video, 3-min video, 3× 15s loops, 7 screenshots
- [ ] Register Product Hunt account, link to X, warm up with 2 comments on other launches
- [ ] Line up **4 hunters** who will commit to launch-day engagement. Brief them on the product in a 5-min Loom.
- [ ] Draft all tweets, LinkedIn posts, Reddit posts, HN post
- [ ] QA install on clean macOS, clean Windows WSL, clean Ubuntu — fix any friction
- [ ] Decide: do we ship a `npx create-mulmoclaude` or keep `git clone` as the CTA? **Recommendation: ship the npx wrapper, it halves the install funnel.**

### T-7 — Pre-announce

- [ ] "Coming Tuesday on PH" tweet with the 15s loop (no link)
- [ ] Post in r/ClaudeAI, r/LocalLLaMA teasers — product demos, not launch CTAs (Reddit hates launch posts)
- [ ] DM 10 Claude Code power users you know — ask for a Tuesday morning try + honest feedback

### T-3 — Warm-up

- [ ] Publish a **blog post** on the Karpathy-KB connection: *"What I learned building a personal wiki for Claude."* This is the intellectual anchor.
- [ ] Submit the blog post to HN. Don't mention PH yet.
- [ ] Draft the PH listing in Maker Studio (do **not** publish — just stage)

### T-0 — Launch day

- **00:01 PT** — Publish on PH. First comment goes up within 90 seconds.
- **00:05 PT** — Tweet thread (7 tweets, one per key message). Pin the tweet.
- **00:10 PT** — LinkedIn, Mastodon, Bluesky cross-post (adapted, not copy-pasted)
- **01:00 PT** — HN "Show HN: MulmoClaude — visual GUI + personal wiki for Claude Code"
- **06:00 PT** — Reddit r/ClaudeAI post (value-first, not launch-y — "I built this, here's the wiki memory idea, here's the code")
- **09:00 PT / 12:00 PT / 15:00 PT / 18:00 PT** — Respond to **every** PH comment within 30 minutes. Non-negotiable.
- **17:00 PT** — Mid-day check: if we're not top-10, ship the Telegram bridge demo video as a fresh post and tag @ProductHunt.
- **21:00 PT** — Thank-you post regardless of placement. Name the top commenters.

### T+1 to T+7 — Compound

- Newsletter sends (dev.to, Hacker Newsletter submission, TLDR Dev pitch)
- Record a "Day after launch — what we learned" post. This outperforms the launch itself 30% of the time.
- Start the interview circuit: pitch the Changelog, Latent Space, and the Anthropic community call.

---

## 8. Channel-by-Channel Playbook

### X / Twitter

**Launch thread (7 tweets) — drafts. Order matches the five key messages + shock demo + CTA.**

1. *MulmoClaude is live on Product Hunt today. It's Claude Code that produces docs, presentations, spreadsheets, videos — and remembers everything. Not an API wrapper. It runs Claude Code directly — your auth, your tools, your files. 🧵*
2. **[Shock demo]** *Drop a research paper in. Out comes a summary document, a slide deck, and a narrated video. No other tools opened. [60s video]*
3. **[Parallel sessions]** *Three Claude Code sessions, one browser tab. One renders a video, one refactors code, one drafts email. Claude Code is no longer single-threaded. [multi-session gif]*
4. **[Compounding memory]** *Every conversation adds to a personal wiki Claude builds and maintains itself — plain Markdown, cross-linked, yours forever. Karpathy's LLM Knowledge Bases idea, shipped. Every other Claude client starts from zero. This one compounds. [wiki gif]*
5. **[Phone as client]** *Message the same agent from Telegram, LINE, Slack, WhatsApp, Discord, Matrix. Fire a task from the subway, see the document (or the narrated video) waiting on your laptop. [bridges gif]*
6. **[Trust]** *Claude runs in a Docker sandbox — auto-detected, no configuration. It only sees your workspace. SSH keys, .env, home dir: invisible. This is the level of care a real shell needs. [sandbox screenshot]*
7. *Try it in your browser right now: [hosted demo link]. Or `git clone` it — open source, AGPL. One upvote on PH costs you nothing and means everything today: [link]*

### Hacker News

Title: **Show HN: MulmoClaude – Claude Code that produces docs, decks, spreadsheets, videos, and remembers everything**

Body (first comment): lead with the **AI-native OS thesis** and the Karpathy *LLM Knowledge Bases* reference. HN respects ideas over features — sell the idea, not the feature list. Explicitly state: *this runs the Claude Code CLI directly, not the API — that's why it can do what it does.*

### Reddit (r/ClaudeAI, r/LocalLLaMA, r/selfhosted)

- NOT a launch post. A build log: *"I spent 8 months giving Claude Code a shell. Here's the wiki-memory idea and what I learned."*
- PH link at the very bottom, one line.

### LinkedIn

**Skip on launch day.** LinkedIn is a phase-2 channel for the productivity audience. Chasing it on day one splits focus and signals "enterprise tool" to PH voters scanning categories. Queue a LinkedIn post for T+3 once the dev wave has landed.

### Japanese community (Note, X-JP)

Satoshi has a strong JP audience. Ship a Japanese version of the maker post and the hero video captions. Launch-day JP tweet at 09:00 JST = 17:00 PT the day before — catches the Asia-Pacific vote window.

---

## 9. Hunters & Community Seed List

- **Hunter target:** someone with 5k+ PH followers, ideally in the Claude/LLM space. If we can't land one, self-hunt — Satoshi's direct network is strong enough.
- **Seed voter list:** 50 people who've starred the repo or engaged with MulmoChat. DM them a calendar reminder Monday evening.
- **Commenter priming:** 4–6 people who will leave substantive (not cheerleading) comments in hours 1, 3, 6, 9. PH's algorithm weights comment velocity and diversity, not just upvotes.

---

## 10. Risks & Mitigations

| Risk                                                   | Probability | Mitigation                                                                                                                           |
| ------------------------------------------------------ | ----------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| **Activation gap — setup too heavy for PH day**        | **High**    | **Ship a hosted demo (see §10.5 below).** `npx create-mulmoclaude` alone isn't enough — 5-min install = 50% drop-off.                |
| Claude Code CLI auth fails on first run                | Medium      | Pre-flight check in the app; friendly error page linking to Claude Code docs                                                          |
| "It's just a wrapper" objection                        | Medium      | Lead with the anti-wrapper line verbatim: *"It runs Claude Code directly — not the API."* Reinforce with wiki + multi-session proof.  |
| Cognitive overload (too many features in one message)  | Medium      | Already addressed in §4 — 9 messages collapsed to 5, rest kept in reserve. Hold the line; don't let screenshots creep the list back. |
| Demo video latency from live Claude calls              | Medium      | Pre-record, splice, never show >3s of spinner                                                                                        |
| AGPL + Docker read as "hacker tool, not safe"          | Medium      | **Reframe:** sandbox = *"the level of care a real shell needs."* AGPL = *"open-source, local-first, no vendor lock-in."* Same facts, different framing. |
| Anthropic ships their own GUI the same week            | Low         | Frame as complementary — local-first, open-source, plugin-extensible                                                                 |
| PH algorithm — late US vote surge from JP timing       | Low         | JP launch tweet timed to catch evening-JP as launch-day-morning-PT                                                                   |

### 10.5 The activation problem — solve this or lose the day

This is the single biggest gap in the v1 plan. Reality check: even with `npx create-mulmoclaude`, the install path is **Node + Claude Code CLI auth + Gemini API key + Docker** — 5 to 10 minutes, developer-only, zero mobile. PH winners are instant gratification. We get upvotes mid-morning, then momentum dies by afternoon because nobody actually tried it.

**Three options, ranked by impact:**

**Option A (strongly recommended) — Hosted read-only demo at `demo.mulmoclaude.com`**
- Pre-loaded workspace with 10 prepared sessions: the research-paper → video flow, a Kyoto-trip doc, an ingested wiki with backlinks, a MulmoCast narrated presentation, a multi-session snapshot.
- Visitors can click through existing artifacts and replay the canvas — no typing required, no auth, no API key, no Docker.
- Budget: ~3 engineer-days. Ship it T-3. **This is the single highest-leverage change in the entire plan.**
- CTA in the hero video and every tweet becomes *"try it in your browser: demo.mulmoclaude.com"* instead of *"git clone"*.

**Option B (minimum viable) — "Watch Claude work" mode**
- A local mode that runs without a Gemini key or Claude auth, using pre-recorded session replays baked into the repo. `npx create-mulmoclaude --demo` drops the user into an interactive walkthrough in 30 seconds.
- Halves drop-off vs. a real install; doesn't match Option A but keeps the activation cost manageable.

**Option C (last resort) — Scripted screenshot walkthrough on the landing page**
- Click-through of the shock demo, parallel sessions, wiki backlinks, Telegram round-trip.
- No real interactivity but preserves the "I experienced it" feeling for PH skimmers.

**Decision:** commit to **Option A by T-7**. If scope slips, fall back to B before touching C.

---

## 11. Success Metrics

**Day of:**
- Product Hunt: **Top 5 of the day**; Top 10 is floor.
- GitHub stars: **+500** in 24h.
- **Hosted-demo sessions: 3,000 unique** (the real activation metric — §10.5).
- Installs (Gemini key inputs as proxy): **500** — secondary, since the demo absorbs the casual traffic.
- PH comments: **50+ substantive** (not counting our team).

**Week of:**
- Stars: **+1,500 cumulative.**
- HN: front page for >2 hours.
- Twitter: 2M+ impressions on launch thread.
- 3+ inbound podcast/interview requests.

**Month of:**
- 2,000 active weekly users (sessions logged).
- 5 community-contributed custom roles or plugins.
- One mention by @karpathy, @alexalbert, or an Anthropic engineer (aspirational but trackable).

---

## 12. The Two Bets

There are two things we have to land. Miss either and the launch is a 6 out of 10.

**Bet 1 — The shot (earns the upvote).**
The hero video's first 20 seconds: **a research paper dropped in, three Claude Code sessions producing a summary doc, a slide deck, and a narrated MulmoCast video in parallel.** That single frame is the pitch — concrete outputs + parallel sessions + MulmoCast, end of sentence. Nothing else on the market looks like it.

**Bet 2 — The hosted demo (earns the try).**
`demo.mulmoclaude.com` lets a PH skimmer click through the shock demo without installing anything. Without this, the upvote from Bet 1 doesn't convert into a GitHub star, a Twitter follow, or a build. Bet 1 gets you noticed; Bet 2 gets you remembered.

Everything else in this plan — bridges, sandbox, roles, wiki tour, skills launcher — is confirmation bias for a viewer who already believes. Cut anything that doesn't serve one of the two bets.

---

## 13. The Story Underneath (why we're doing this at all)

This is the first visible surface of a much bigger thesis: **computing is being re-platformed on top of AI agents, and the shell that platform needs doesn't exist yet.** Claude Code is the kernel. MulmoClaude is the first draft of the shell.

If the launch goes well, we're not celebrating a successful product launch — we're announcing the existence of a new computing surface. Phase 2 audiences (productivity users, knowledge workers, JP market, enterprise) come later, pulled in by the dev-native gravity we establish on day one.

That framing is what makes this plan aggressive rather than cautious. We're not trying to be a "very advanced tool." We're trying to show a glimpse of the future of computing, through one sharp product.

---

*Prepared for the MulmoClaude launch. Revise after the asset dry-run at T-7. Hosted-demo scope decision at T-10 — this is the critical path item.*
