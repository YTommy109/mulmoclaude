import { execFile, spawn } from "child_process";
import { promisify } from "util";
import { createHash } from "crypto";
import { readFileSync, statSync } from "fs";
import { resolve as resolvePath } from "path";
import { log } from "./logger/index.js";
import { env } from "./env.js";
import { SUBPROCESS_PROBE_TIMEOUT_MS } from "../utils/time.js";
import { claudeConfigDir, claudeConfigJson } from "../utils/claudeConfigPath.js";

const execFileAsync = promisify(execFile);

const IMAGE_NAME = "mulmoclaude-sandbox";
const DOCKERFILE = "Dockerfile.sandbox";
const LABEL_KEY = "mulmoclaude.dockerfile.sha256";

let _dockerEnabled: boolean | null = null;

function assertClaudeFiles(): void {
  const claudeDir = claudeConfigDir();
  const claudeJson = claudeConfigJson();
  const overrideHint = "Set CLAUDE_CONFIG_DIR / CLAUDE_CONFIG_JSON to point at your install if it lives elsewhere.";

  try {
    if (!statSync(claudeDir).isDirectory()) {
      log.error("sandbox", `${claudeDir} exists but is not a directory. ${overrideHint}`);
      process.exit(1);
    }
  } catch {
    log.error("sandbox", `${claudeDir} not found. Run 'claude' once to initialize. ${overrideHint}`);
    process.exit(1);
  }

  try {
    if (!statSync(claudeJson).isFile()) {
      log.error("sandbox", `${claudeJson} exists but is not a file. ${overrideHint}`);
      process.exit(1);
    }
  } catch {
    log.error("sandbox", `${claudeJson} not found. Run 'claude' once to initialize. ${overrideHint}`);
    process.exit(1);
  }
}

/** Pure daemon-liveness probe: `docker ps -q` succeeds only when the
 *  client is installed AND the daemon is reachable. No config or
 *  caching concerns — the optional-deps registry owns the PATH check
 *  and caching; this is just the liveness half. */
export async function isDockerLive(): Promise<boolean> {
  try {
    await execFileAsync("docker", ["ps", "-q"], {
      timeout: SUBPROCESS_PROBE_TIMEOUT_MS,
    });
    return true;
  } catch {
    return false;
  }
}

export async function isDockerAvailable(): Promise<boolean> {
  if (env.disableSandbox) return false;
  if (_dockerEnabled !== null) return _dockerEnabled;
  assertClaudeFiles();
  _dockerEnabled = await isDockerLive();
  return _dockerEnabled;
}

function getDockerfileSha256(): string {
  const content = readFileSync(resolvePath(process.cwd(), DOCKERFILE));
  return createHash("sha256").update(content).digest("hex");
}

async function buildImage(sha: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("docker", ["build", "-t", IMAGE_NAME, "--label", `${LABEL_KEY}=${sha}`, "-f", DOCKERFILE, "--load", "."], {
      cwd: process.cwd(),
      stdio: ["ignore", "inherit", "inherit"],
    });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`docker build exited with code ${code}`));
    });
  });
}

export async function ensureSandboxImage(): Promise<void> {
  const expectedSha = getDockerfileSha256();

  let needsBuild = false;
  try {
    const { stdout } = await execFileAsync("docker", ["image", "inspect", IMAGE_NAME, "--format", `{{index .Config.Labels "${LABEL_KEY}"}}`]);
    if (stdout.trim() !== expectedSha) {
      log.info("sandbox", "Dockerfile.sandbox changed, rebuilding sandbox image...");
      needsBuild = true;
    }
  } catch {
    log.info("sandbox", "Building sandbox image (first time only, may take a minute)...");
    needsBuild = true;
  }

  if (needsBuild) {
    await buildImage(expectedSha);
    log.info("sandbox", "Sandbox image built.");
  }
}

/**
 * Return the IPv4 gateway address of Docker's default bridge network,
 * or null if it cannot be determined. Docker containers using
 * `--add-host host.docker.internal:host-gateway` resolve to this IP,
 * so the server must listen on it for MCP server → host HTTP calls.
 *
 * We query the Docker daemon directly rather than reading
 * `os.networkInterfaces()` because Node skips the `docker0` interface
 * when its link state is DOWN (which it is whenever no containers are
 * running — exactly when we need the IP at server startup).
 */
export async function getDockerBridgeIp(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("docker", ["network", "inspect", "bridge", "-f", "{{(index .IPAM.Config 0).Gateway}}"]);
    const ipAddr = stdout.trim();
    // Sanity-check: must look like an IPv4 address
    return /^\d+\.\d+\.\d+\.\d+$/.test(ipAddr) ? ipAddr : null;
  } catch {
    return null;
  }
}
