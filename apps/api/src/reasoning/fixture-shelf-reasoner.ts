import {
  SHELF_AUDIT_SCHEMA_VERSION,
  ShelfAuditSchema,
  type ShelfAudit,
} from "@shelf-audit/contracts";

import type {
  Account,
  AccountAssortmentItem,
} from "../persistence/audit-repository.js";
import type { CandidateFrame, VideoMetadata } from "../video/types.js";
import type { DetectorRun } from "../perception/local-detector.js";

export interface ShelfReasoner {
  readonly provider?: string;
  readonly model?: string;
  analyze(input: {
    auditId: string;
    account: Account;
    sourceVideoPath: string;
    metadata: VideoMetadata;
    frames: CandidateFrame[];
    qualityWarnings?: string[];
    detector?: Pick<DetectorRun, "available" | "version" | "warnings">;
    assortment?: AccountAssortmentItem[];
  }): Promise<ShelfAudit>;
}

export class FixtureShelfReasoner implements ShelfReasoner {
  readonly provider = "fixture";
  readonly model = "deterministic";
  async analyze(input: {
    auditId: string;
    account: Account;
    sourceVideoPath: string;
    metadata: VideoMetadata;
    frames: CandidateFrame[];
    qualityWarnings?: string[];
    detector?: Pick<DetectorRun, "available" | "version" | "warnings">;
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
      catalogScope: {
        observedCategory: "unknown",
        catalogCategory: null,
        status: "no_matching_catalog",
      },
      captureQuality: {
        status: input.metadata.warnings.length > 0 ? "degraded" : "usable",
        warnings: [
          ...input.metadata.warnings,
          ...(input.qualityWarnings ?? []),
          ...(input.detector?.warnings ?? []),
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
        ...(input.detector ? { detectorVersion: input.detector.version } : {}),
      },
    });
  }
}
