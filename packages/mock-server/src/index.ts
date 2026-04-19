#!/usr/bin/env node
// @mulmobridge/mock-server — mock MulmoClaude server for bridge testing.
//
// Usage:
//   npx @mulmobridge/mock-server [options]
//
// Options:
//   --port <n>        Listen port (default: 3001)
//   --token <s>       Bearer token (default: mock-test-token)
//   --slow <ms>       Add delay before replies (default: 0)
//   --error           Always return error acks
//   --reject-auth     Reject all connections (test error handling)
//   --verbose, -v     Full protocol trace logging
//   --log-file <path> Write verbose log to file (always verbose)

import { createMockServer, type MockServerOptions } from "./server.js";

function failUsage(message: string): never {
  console.error(`Error: ${message}`);
  printHelp();
  process.exit(1);
}

function parsePort(raw: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0 || n > 65535) {
    failUsage(`--port must be an integer between 1 and 65535, got "${raw}"`);
  }
  return n;
}

function parseSlowMs(raw: string): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    failUsage(`--slow must be a non-negative number, got "${raw}"`);
  }
  return n;
}

function parseArgs(argv: string[]): MockServerOptions {
  const opts: MockServerOptions = {
    port: 3001,
    token: "mock-test-token",
    slowMs: 0,
    alwaysError: false,
    rejectAuth: false,
    verbose: false,
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--port" && argv[i + 1]) {
      opts.port = parsePort(argv[++i]);
    } else if (arg === "--token" && argv[i + 1]) {
      opts.token = argv[++i];
    } else if (arg === "--slow" && argv[i + 1]) {
      opts.slowMs = parseSlowMs(argv[++i]);
    } else if (arg === "--error") {
      opts.alwaysError = true;
    } else if (arg === "--reject-auth") {
      opts.rejectAuth = true;
    } else if (arg === "--verbose" || arg === "-v") {
      opts.verbose = true;
    } else if (arg === "--log-file" && argv[i + 1]) {
      opts.logFile = argv[++i];
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else if (arg.startsWith("-")) {
      failUsage(`unknown option: ${arg}`);
    }
  }
  return opts;
}

function printHelp(): void {
  console.log(`
@mulmobridge/mock-server — mock MulmoClaude server for bridge testing

Usage:
  npx @mulmobridge/mock-server [options]

Options:
  --port <n>         Listen port (default: 3001)
  --token <s>        Bearer token (default: mock-test-token)
  --slow <ms>        Add delay before replies (default: 0)
  --error            Always return error acks
  --reject-auth      Reject all connections (test error handling)
  --verbose, -v      Full protocol trace logging
  --log-file <path>  Write verbose log to file
  --help, -h         Show this help

Examples:
  # Basic echo mode
  npx @mulmobridge/mock-server

  # Test with the CLI bridge
  MULMOCLAUDE_AUTH_TOKEN=mock-test-token npx @mulmobridge/cli

  # Slow responses (simulate agent thinking)
  npx @mulmobridge/mock-server --slow 2000

  # Test error handling
  npx @mulmobridge/mock-server --error

  # Debug mode with full protocol trace
  npx @mulmobridge/mock-server --verbose
`);
}

const opts = parseArgs(process.argv);
createMockServer(opts);
