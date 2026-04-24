---
name: setup-mulmoclaude
description: Interactively guide MulmoClaude setup following README instructions. Checks port conflicts, Docker status, and common pitfalls. Respond in the user's language.
allowed-tools: Read, Bash, Glob, Grep
---

# Setup MulmoClaude

Guide the user through MulmoClaude setup following README.md (Installation / Running the App sections). Claude handles checks and pitfall guidance.

## Step 1: Follow README setup

Read README.md Installation section and walk the user through it (`yarn install` → `.env`).

## Step 2: Port 5173 availability

```bash
lsof -i :5173 -sTCP:LISTEN
```

- **Available**: proceed
- **In use**: show PID and command. Suggest that MulmoClaude may already be running — skip to Step 4 browser open, or stop the process with `Ctrl+C`

## Step 3: Docker check

1. If `.env` has `DISABLE_SANDBOX=1`, skip
2. If `which docker` not found, point to README Docker section
3. Check `docker info`. If not running, start with `open -a Docker` and wait

## Step 4: Start dev server

Ask the user to run `yarn dev` in a **separate terminal** (not as a background process — so they can `Ctrl+C` to stop).

> `[server] ... INFO  [server] listening port=3001` means ready. `[client] ➜ Local: http://localhost:5173/` alone means only the frontend is ready, backend is still starting.

Once ready, open `http://localhost:5173` and verify the General role is displayed.

## Common pitfalls

| Symptom | Cause | Fix |
|---|---|---|
| `ERR_MODULE_NOT_FOUND: @mulmobridge/...` | `yarn install` not run or incomplete | Re-run `yarn install` |
| `[sandbox] ... not found.` | Host `claude` not authenticated or expired | Run `claude` once to authenticate |
| Startup hangs silently | macOS TCC dialog hidden in background | Check for Docker folder access permission dialog |
| `EADDRINUSE :5173` | Port conflict | Stop the conflicting process |
| Vite stuck pending | Dependency re-optimization after lockfile change | `rm -rf node_modules/.vite && yarn dev` |
