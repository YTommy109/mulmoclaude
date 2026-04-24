---
name: start-mulmoclaude
description: Quickly start a pre-configured MulmoClaude. Checks port conflicts and Docker status, then guides the user to run yarn dev in a separate terminal and open the browser. Suggests /setup-mulmoclaude if initial setup is needed. Respond in the user's language.
allowed-tools: Read, Bash, Glob, Grep
---

# Start MulmoClaude

Quickly start a pre-configured MulmoClaude. `yarn dev` should be run by the user in their own terminal (so they can `Ctrl+C` to stop).

## Step 1: Pre-flight checks

1. Verify `package.json` `name` is `mulmoclaude`. If not, stop and ask user to navigate to the repo root.
2. Check port 5173 is available (`lsof -i :5173 -sTCP:LISTEN`). If in use, advise accordingly.
3. Docker check (skip if `.env` has `DISABLE_SANDBOX=1`; otherwise check `docker info`, start with `open -a Docker` if not running).

## Step 2: Start dev server

Ask user to run `yarn dev` in a separate terminal. Once `[server] listening port=3001` appears, open `http://localhost:5173`.

On failure, refer to `/setup-mulmoclaude` pitfall table.
