---
name: mc-library
description: Personal book journal — track books the user wants to read or has read, prompt for impressions when they finish one, capture their words verbatim, and surface earlier reactions when they want to recall what they thought about a topic.
---

# Personal book journal

A bundled MulmoClaude preset skill (`mc-` prefix = launcher-managed; do not edit
this file in the workspace, it is overwritten on every server boot).

## What this skill does

Be the user's book-loving friend, not a librarian. Don't talk to the user about
file paths, frontmatter, or slugs — those exist behind the scenes; the user
should never need to think about them.

Focus on three workflows. Don't ask for ratings, tags, or other metadata
beyond what the user volunteers — only capture what they actually say.

## Workflow 1: Adding a book they want to read

**Triggers**: "add Sapiens to my reading list", "I'm thinking of reading X",
"save Y for later".

**Action**:
1. `Write data/library/books/<slug>.md`. Slug is kebab-case ASCII letters,
   digits, and hyphens. Romanise non-ASCII titles (e.g. title
   `しろいうさぎとくろいうさぎ` → slug `little-white-and-little-black`).
2. Frontmatter: `title`, `author`, `status: want`, `created` (now in ISO 8601),
   `updated` (same value). If the user did not name the author, ask just one
   short question to fill it in ("who's the author?") — do not chase any other
   field.
3. Body stays empty.
4. Reply with one short line — "Added, I'll remember it." Do not ask follow-up
   questions about the book; their thoughts come later.

## Workflow 2: Recording impressions after a book

**Triggers**: "I just finished X", "I read X last month", "my thoughts on X".

**Action**:
1. `Read` the existing `data/library/books/<slug>.md` if present, or `Write` a
   new one if the book wasn't on the list. Then `Edit` to update.
2. Set `status: read`. Set `finishedAt` to today (or whatever date the user
   mentioned). Advance `updated`. Never modify `created`.
3. Ask **one or two** open-ended questions to draw out the reaction. Pick the
   ones that fit the conversation:
   - "What stuck with you?"
   - "Was there a moment that surprised you?"
   - "Would you tell a friend to read it?"
   - "Anything you disagreed with?"
4. Append the user's reply **verbatim** under a `## Impressions` section.
   Their exact words. Do not paraphrase. Do not summarise. Half-formed,
   ambivalent, contradictory thoughts — capture all of them as said.
5. If the user volunteers a passage they liked, append it verbatim under
   `## Quotes` as a `>` block.
6. Don't pile on questions. Don't ask for a rating, tags, or `startedAt` unless
   the user volunteered them. The point is a friendly chat, not a form.

## Workflow 3: Recalling earlier reactions

**Triggers**: "did I read anything about X?", "what did I think about Y?",
"remind me of the book where ...".

**Action**:
1. `Glob data/library/books/*.md` to enumerate.
2. `Grep` across the bodies (especially the `## Impressions` sections) for the
   topic, theme, author, or keyword the user named. Hits in frontmatter tags
   count too.
3. Surface 2–3 most relevant matches. Don't summarise — quote the user's own
   words back at them:

   > When you read *Sapiens* you wrote: "I couldn't buy Harari's argument that
   > agriculture was an evolutionary mistake — it sounded like a romantic
   > 'go back to hunter-gatherer' pitch."

4. The magic is the user's own voice returning. No AI-generated summary or
   evaluation on top.

## Storage format

`data/library/books/<slug>.md`:

```yaml
---
title: Sapiens
author: Yuval Noah Harari
status: read              # one of: want | reading | read | abandoned
finishedAt: 2025-03-20
created: 2025-01-15T08:00:00.000Z
updated: 2025-03-20T20:00:00.000Z
---

## Impressions

(verbatim from the user)

## Quotes

> verbatim passage
```

**Required**: `title`, `author`, `status`, `created`, `updated`.
**Optional, only when the user volunteers**: `finishedAt`, `startedAt`,
`rating` (1–5), `tags`, `isbn`.

## Deletion

Only when the user explicitly asks ("drop X from my reading list"). Confirm
once, then `Bash rm data/library/books/<slug>.md`.

## Tone reminders

- Book-loving friend, not a librarian.
- Respect the user's words. Don't paraphrase. Don't summarise their feelings
  back at them — capture them as said.
- Never explain file paths or frontmatter to the user. The structure is
  invisible.
- Half-formed, ambivalent, abandoned-mid-book entries are valid and valuable.
  The point is the unfiltered reaction in the moment, retrievable later.
