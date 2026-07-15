import {
  SHELF_AUDIT_SCHEMA_VERSION,
  ShelfAuditSchema,
  type ShelfAudit,
} from "@shelf-audit/contracts";

import type { Account } from "../persistence/audit-repository.js";
import type { CandidateFrame, VideoMetadata } from "../video/types.js";

export interface ShelfReasoner {
  analyze(input: {
    auditId: string;
    account: Account;
    sourceVideoPath: string;
    metadata: VideoMetadata;
    frames: CandidateFrame[];
  }): Promise<ShelfAudit>;
}

export class FixtureShelfReasoner implements ShelfReasoner {
  async analyze(input: {
    auditId: string;
    account: Account;
    sourceVideoPath: string;
    metadata: VideoMetadata;
    frames: CandidateFrame[];
  }): Promise<ShelfAudit> {
    return ShelfAuditSchema.parse({
      auditId: input.auditId,
      schemaVersion: SHELF_AUDIT_SCHEMA_VERSION,
      account: {
        accountId: input.account.id,
        resolutionMethod: "user_selected",
      },
      sourceVideo: { mediaPath: input.sourceVideoPath },
      status: "completed",
      captureQuality: {
        status: input.metadata.warnings.length > 0 ? "degraded" : "usable",
        warnings: [
          ...input.metadata.warnings,
          `Fixture analysis used ${input.frames.length} representative frame(s).`,
        ],
      },
      observations: [],
      outOfStocks: [],
      insights: [],
      notes: ["Fixture reasoner result; no managed-model inference was used."],
      provenance: {
        pipelineVersion: "fixture-v1",
        provider: "fixture",
        model: "deterministic",
      },
    });
  }
}
