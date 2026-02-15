/**
 * Optional OS-level sandbox integration via @anthropic-ai/sandbox-runtime.
 *
 * When enabled (MCP_TERMINAL_SANDBOX=true), wraps spawned commands with
 * kernel-level filesystem and network restrictions using sandbox-exec (macOS)
 * or bubblewrap (Linux).
 *
 * This is an optional feature — if the package isn't installed or the platform
 * isn't supported, it logs a warning and falls back to unsandboxed execution.
 */

import type { ServerConfig } from "./types.js";
import { audit } from "./utils/audit-logger.js";

// Lazy-loaded sandbox manager instance
let sandboxManager: any = null;
let sandboxInitialized = false;
let sandboxAvailable = false;

/**
 * Initialize the sandbox if enabled in config.
 * Call this once at startup. Safe to call even if the package isn't installed.
 */
export async function initSandbox(config: ServerConfig): Promise<boolean> {
  if (!config.sandbox) return false;

  try {
    const { SandboxManager } = await import("@anthropic-ai/sandbox-runtime");
    sandboxManager = SandboxManager;

    // Check platform support
    if (!SandboxManager.isSupportedPlatform()) {
      console.error("[mcp-terminal] Sandbox: platform not supported, sandbox disabled");
      return false;
    }

    // Build config from our env vars
    const allowWrite = config.sandboxAllowWrite.length > 0
      ? config.sandboxAllowWrite
      : ["/tmp"];

    const allowedDomains = config.sandboxAllowNetwork[0] === "*"
      ? [] // Empty = no restriction (but sandbox-runtime treats empty as "block all")
      : config.sandboxAllowNetwork;

    // If user wants unrestricted network ("*"), we use a permissive config
    const networkConfig = config.sandboxAllowNetwork[0] === "*"
      ? { allowedDomains: ["*"], deniedDomains: [] as string[] }
      : { allowedDomains, deniedDomains: [] as string[] };

    await SandboxManager.initialize({
      network: networkConfig,
      filesystem: {
        denyRead: [],
        allowWrite,
        denyWrite: [],
      },
      allowPty: true,
    });

    sandboxInitialized = true;
    sandboxAvailable = true;
    audit("sandbox_init", undefined, { allowWrite, network: config.sandboxAllowNetwork });
    console.error(`[mcp-terminal] Sandbox: ENABLED (write: ${allowWrite.join(", ")}, network: ${config.sandboxAllowNetwork.join(", ")})`);
    return true;
  } catch (err) {
    audit("sandbox_fail", undefined, { error: String(err) });
    console.error(`[mcp-terminal] Sandbox: failed to initialize (${err}). Sandbox disabled.`);
    return false;
  }
}

/**
 * Wrap a command string with sandbox restrictions.
 * Returns the original command unchanged if sandbox is not available.
 */
export async function wrapCommand(command: string): Promise<{ command: string; useShell: boolean }> {
  if (!sandboxAvailable || !sandboxManager) {
    return { command, useShell: false };
  }

  try {
    const wrapped = await sandboxManager.wrapWithSandbox(command);
    return { command: wrapped, useShell: true };
  } catch (err) {
    console.error(`[mcp-terminal] Sandbox: wrapWithSandbox failed (${err}), running unsandboxed`);
    return { command, useShell: false };
  }
}

/**
 * Check if sandbox is currently active.
 */
export function isSandboxActive(): boolean {
  return sandboxAvailable;
}

/**
 * Cleanup sandbox resources on shutdown.
 */
export async function resetSandbox(): Promise<void> {
  if (sandboxManager && sandboxInitialized) {
    try {
      await sandboxManager.reset();
    } catch {
      // Ignore cleanup errors
    }
  }
}
