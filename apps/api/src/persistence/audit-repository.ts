import type { PGlite } from "@electric-sql/pglite";
import { ShelfAuditSchema, type ShelfAudit } from "@shelf-audit/contracts";

import type { AuditRunStatus } from "./types.js";
import {
  isAllowedAuditTransition,
  isRecoverableStatus,
} from "./state-machine.js";

export type Account = {
  id: string;
  name: string;
  externalIdentifier: string;
  region: string | null;
};

export type AccountAssortmentItem = {
  productId: string;
  brand: string;
  product: string;
  variant: string | null;
  size: string | null;
  expectedPresence: boolean;
  expectedFacings: number | null;
  expectedShelfPosition: string | null;
  expectedPriceCents: number | null;
};

export type AuditRun = {
  id: string;
  accountId: string;
  status: AuditRunStatus;
  sourceVideoPath: string;
  provider: string;
  model: string;
  errorCode: string | null;
  errorMessage: string | null;
  stageLatencies: Record<string, number>;
  finalAudit: ShelfAudit | null;
};

export type CreateAuditInput = Omit<
  AuditRun,
  "status" | "errorCode" | "errorMessage" | "stageLatencies" | "finalAudit"
>;

export interface AuditRepository {
  listAccounts(): Promise<Account[]>;
  listAccountAssortment(accountId: string): Promise<AccountAssortmentItem[]>;
  createAudit(input: CreateAuditInput): Promise<AuditRun>;
  getAudit(auditId: string): Promise<AuditRun>;
  transitionAudit(
    auditId: string,
    nextStatus: AuditRunStatus,
    failure?: { errorCode: string; errorMessage: string },
  ): Promise<AuditRun>;
  completeAudit(
    auditId: string,
    finalAudit: ShelfAudit,
    stageLatencies: Record<string, number>,
  ): Promise<AuditRun>;
  recordStageLatencies(
    auditId: string,
    stageLatencies: Record<string, number>,
  ): Promise<void>;
  recoverAbandonedAudits(): Promise<number>;
}

type AccountRow = {
  id: string;
  name: string;
  external_identifier: string;
  region: string | null;
};

type AssortmentRow = {
  product_id: string;
  brand: string;
  product: string;
  variant: string | null;
  size: string | null;
  expected_presence: boolean;
  expected_facings: number | null;
  expected_shelf_position: string | null;
  expected_price_cents: number | null;
};

type AuditRow = {
  id: string;
  account_id: string;
  status: AuditRunStatus;
  source_video_path: string;
  provider: string;
  model: string;
  error_code: string | null;
  error_message: string | null;
  stage_latencies: Record<string, number> | string;
  final_audit: ShelfAudit | string | null;
};

export class AuditRepositoryError extends Error {
  constructor(
    message: string,
    readonly code: "AUDIT_NOT_FOUND" | "INVALID_AUDIT_TRANSITION",
  ) {
    super(message);
    this.name = "AuditRepositoryError";
  }
}

function toAuditRun(row: AuditRow): AuditRun {
  return {
    id: row.id,
    accountId: row.account_id,
    status: row.status,
    sourceVideoPath: row.source_video_path,
    provider: row.provider,
    model: row.model,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    stageLatencies:
      typeof row.stage_latencies === "string"
        ? (JSON.parse(row.stage_latencies) as Record<string, number>)
        : row.stage_latencies,
    finalAudit:
      row.final_audit === null
        ? null
        : ShelfAuditSchema.parse(
            typeof row.final_audit === "string"
              ? JSON.parse(row.final_audit)
              : row.final_audit,
          ),
  };
}

export class PGliteAuditRepository implements AuditRepository {
  constructor(private readonly database: PGlite) {}

  async listAccounts(): Promise<Account[]> {
    const result = await this.database.query<AccountRow>(
      "SELECT id, name, external_identifier, region FROM accounts ORDER BY name",
    );
    return result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      externalIdentifier: row.external_identifier,
      region: row.region,
    }));
  }

  async listAccountAssortment(
    accountId: string,
  ): Promise<AccountAssortmentItem[]> {
    const result = await this.database.query<AssortmentRow>(
      `SELECT assortment.product_id, product.brand, product.product, product.variant, product.size,
              assortment.expected_presence, assortment.expected_facings,
              assortment.expected_shelf_position, assortment.expected_price_cents
       FROM account_assortments AS assortment
       JOIN products AS product ON product.id = assortment.product_id
       WHERE assortment.account_id = $1
       ORDER BY product.brand, product.product, product.variant`,
      [accountId],
    );
    return result.rows.map((row) => ({
      productId: row.product_id,
      brand: row.brand,
      product: row.product,
      variant: row.variant,
      size: row.size,
      expectedPresence: row.expected_presence,
      expectedFacings: row.expected_facings,
      expectedShelfPosition: row.expected_shelf_position,
      expectedPriceCents: row.expected_price_cents,
    }));
  }

  async createAudit(input: CreateAuditInput): Promise<AuditRun> {
    const result = await this.database.query<AuditRow>(
      `INSERT INTO audit_runs (id, account_id, status, source_video_path, provider, model)
       VALUES ($1, $2, 'created', $3, $4, $5)
       RETURNING id, account_id, status, source_video_path, provider, model, error_code, error_message, stage_latencies, final_audit`,
      [
        input.id,
        input.accountId,
        input.sourceVideoPath,
        input.provider,
        input.model,
      ],
    );
    return toAuditRun(result.rows[0]);
  }

  async getAudit(auditId: string): Promise<AuditRun> {
    const result = await this.database.query<AuditRow>(
      `SELECT id, account_id, status, source_video_path, provider, model, error_code, error_message, stage_latencies, final_audit
       FROM audit_runs WHERE id = $1`,
      [auditId],
    );
    const row = result.rows[0];
    if (!row) {
      throw new AuditRepositoryError(
        `Audit '${auditId}' was not found.`,
        "AUDIT_NOT_FOUND",
      );
    }
    return toAuditRun(row);
  }

  async transitionAudit(
    auditId: string,
    nextStatus: AuditRunStatus,
    failure?: { errorCode: string; errorMessage: string },
  ): Promise<AuditRun> {
    const current = await this.getAudit(auditId);
    if (!isAllowedAuditTransition(current.status, nextStatus)) {
      throw new AuditRepositoryError(
        `Cannot transition audit '${auditId}' from '${current.status}' to '${nextStatus}'.`,
        "INVALID_AUDIT_TRANSITION",
      );
    }

    const result = await this.database.query<AuditRow>(
      `UPDATE audit_runs
       SET status = $2, error_code = $3, error_message = $4, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1
       RETURNING id, account_id, status, source_video_path, provider, model, error_code, error_message, stage_latencies, final_audit`,
      [
        auditId,
        nextStatus,
        failure?.errorCode ?? null,
        failure?.errorMessage ?? null,
      ],
    );
    return toAuditRun(result.rows[0]);
  }

  async completeAudit(
    auditId: string,
    finalAudit: ShelfAudit,
    stageLatencies: Record<string, number>,
  ): Promise<AuditRun> {
    const current = await this.getAudit(auditId);
    if (!isAllowedAuditTransition(current.status, "completed")) {
      throw new AuditRepositoryError(
        `Cannot complete audit '${auditId}' from '${current.status}'.`,
        "INVALID_AUDIT_TRANSITION",
      );
    }
    const validatedAudit = ShelfAuditSchema.parse(finalAudit);
    const result = await this.database.query<AuditRow>(
      `UPDATE audit_runs
       SET status = 'completed', final_audit = $2::jsonb, stage_latencies = $3::jsonb,
           error_code = NULL, error_message = NULL, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1
       RETURNING id, account_id, status, source_video_path, provider, model, error_code, error_message, stage_latencies, final_audit`,
      [auditId, JSON.stringify(validatedAudit), JSON.stringify(stageLatencies)],
    );
    return toAuditRun(result.rows[0]);
  }

  async recordStageLatencies(
    auditId: string,
    stageLatencies: Record<string, number>,
  ): Promise<void> {
    await this.database.query(
      "UPDATE audit_runs SET stage_latencies = $2::jsonb, updated_at = CURRENT_TIMESTAMP WHERE id = $1",
      [auditId, JSON.stringify(stageLatencies)],
    );
  }

  async recoverAbandonedAudits(): Promise<number> {
    const result = await this.database.query<{ id: string }>(
      `UPDATE audit_runs
       SET status = 'failed', error_code = 'ABANDONED_AUDIT',
           error_message = 'The local service restarted before processing finished.',
           updated_at = CURRENT_TIMESTAMP
       WHERE status <> ALL($1)
       RETURNING id`,
      [["created", "completed", "failed"]],
    );
    return result.rows.length;
  }
}

export function isAuditRunRecoverable(status: AuditRunStatus): boolean {
  return isRecoverableStatus(status);
}
