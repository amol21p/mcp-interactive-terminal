import type { SessionManager } from "../session-manager.js";
import type { SessionInfo } from "../types.js";

export async function handleListSessions(
  sessionManager: SessionManager,
): Promise<SessionInfo[]> {
  return sessionManager.listSessions();
}
