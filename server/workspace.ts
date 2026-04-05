import { execSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

export const workspacePath = path.join(os.homedir(), "mulmoclaude");

const SUBDIRS = [
  "chat",
  "todos",
  "calendar",
  "contacts",
  "scheduler",
  "roles",
  "stories",
];

export function initWorkspace(): string {
  // Create directory structure if needed
  fs.mkdirSync(workspacePath, { recursive: true });
  for (const dir of SUBDIRS) {
    fs.mkdirSync(path.join(workspacePath, dir), { recursive: true });
  }

  // Create memory.md if it doesn't exist
  const memoryFile = path.join(workspacePath, "memory.md");
  if (!fs.existsSync(memoryFile)) {
    fs.writeFileSync(
      memoryFile,
      "# Memory\n\nDistilled facts about you and your work.\n",
    );
  }

  // Create about.md if it doesn't exist
  const aboutFile = path.join(workspacePath, "about.md");
  if (!fs.existsSync(aboutFile)) {
    fs.writeFileSync(
      aboutFile,
      `# About MulmoClaude

MulmoClaude is a text and task-driven AI agent app with rich visual output. It uses the Claude Code Agent SDK as its LLM core and gui-chat-protocol as its plugin layer.

**Core philosophy**: The workspace is the database. Files are the source of truth. Claude is the intelligent interface.

## Roles

- **General** — Everyday assistant: task management, scheduling, general Q&A.
- **Office** — Creates and edits documents, spreadsheets, and presentations.
- **Brainstorm** — Explores ideas via mind maps, images, and documents.
- **Recipe Guide** — Step-by-step cooking instructor.
- *(Additional roles may be defined by the user in the workspace.)*

## Key Capabilities

- Manage a todo list and calendar scheduler
- Present documents and spreadsheets with rich formatting
- Generate and edit images
- Create interactive mind maps
- Generate and edit HTML pages / 3D scenes
- Present MulmoScript multimedia stories
- Show music visualizations
- Manage a personal knowledge wiki
- Switch between roles mid-conversation
- Ask clarifying questions via interactive forms
- Play games (Othello)

## Workspace Layout

\`\`\`
~/mulmoclaude/
  chat/        ← session tool results (.jsonl per session)
  todos/       ← todo items
  calendar/    ← calendar events
  contacts/    ← address book
  wiki/        ← personal knowledge wiki
  about.md     ← this file; what MulmoClaude is
  memory.md    ← distilled facts loaded into every session
\`\`\`
`,
    );
  }

  // Git init if not already a repo
  const gitDir = path.join(workspacePath, ".git");
  if (!fs.existsSync(gitDir)) {
    execSync("git init", { cwd: workspacePath });
    console.log(`Initialized git repository in ${workspacePath}`);
  }

  console.log(`Workspace: ${workspacePath}`);
  return workspacePath;
}
