import type { AuditRunStatus } from "./types.js";

const nextAuditStatuses: Readonly<
  Record<AuditRunStatus, readonly AuditRunStatus[]>
> = {
  created: ["uploading"],
  uploading: ["uploaded", "failed"],
  uploaded: ["extracting_frames", "failed"],
  extracting_frames: ["selecting_frames", "failed"],
  selecting_frames: ["local_detection", "failed"],
  local_detection: ["managed_reasoning", "failed"],
  managed_reasoning: ["grounding", "failed"],
  grounding: ["persisting", "failed"],
  persisting: ["completed", "failed"],
  completed: [],
  failed: [],
};

export function isAllowedAuditTransition(
  currentStatus: AuditRunStatus,
  nextStatus: AuditRunStatus,
): boolean {
  return nextAuditStatuses[currentStatus].includes(nextStatus);
}

export function isRecoverableStatus(status: AuditRunStatus): boolean {
  return status !== "created" && status !== "completed" && status !== "failed";
}
