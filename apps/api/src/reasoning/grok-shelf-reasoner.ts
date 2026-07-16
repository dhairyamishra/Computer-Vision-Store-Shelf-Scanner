import { readFile } from "node:fs/promises";
import { z } from "zod";

import {
  RawShelfAnalysisSchema,
  SHELF_AUDIT_SCHEMA_VERSION,
  ShelfAuditSchema,
  type ShelfAudit,
} from "@shelf-audit/contracts";

import type { ShelfReasoner } from "./fixture-shelf-reasoner.js";

const rawShelfAnalysisJsonSchema = z.toJSONSchema(RawShelfAnalysisSchema);

export class ReasoningError extends Error {
  constructor(
    message: string,
    readonly code:
      | "AI_PROVIDER_NOT_CONFIGURED"
      | "AI_PROVIDER_FAILED"
      | "AI_PROVIDER_INVALID_RESPONSE",
  ) {
    super(message);
    this.name = "ReasoningError";
  }
}

function normalizeProviderOutput(candidate: unknown): unknown {
  if (!candidate || typeof candidate !== "object") {
    return candidate;
  }
  const analysis = candidate as Record<string, unknown>;
  const captureQuality = analysis.captureQuality;
  if (captureQuality && typeof captureQuality === "object") {
    const quality = captureQuality as Record<string, unknown>;
    if (quality.status === "ok" || quality.status === "good") {
      quality.status = "usable";
    } else if (quality.status === "poor") {
      quality.status = "degraded";
    }
    if (Array.isArray(quality.warnings)) {
      quality.warnings = quality.warnings.slice(0, 20);
    }
  }
  if (typeof analysis.notes === "string") {
    analysis.notes = [analysis.notes];
  } else if (Array.isArray(analysis.notes)) {
    analysis.notes = analysis.notes.slice(0, 20);
  }
  if (!Array.isArray(analysis.observations)) {
    return analysis;
  }
  for (const observation of analysis.observations) {
    if (!observation || typeof observation !== "object") {
      continue;
    }
    const fields = [
      "brand",
      "product",
      "variant",
      "sizeOrPack",
      "facings",
      "shelfPosition",
    ];
    for (const field of fields) {
      const claim = (observation as Record<string, unknown>)[field];
      if (!claim || typeof claim !== "object") {
        continue;
      }
      const normalizedClaim = claim as Record<string, unknown>;
      if (typeof normalizedClaim.confidence === "number") {
        normalizedClaim.confidenceLevel =
          normalizedClaim.confidence >= 0.8
            ? "high"
            : normalizedClaim.confidence >= 0.5
              ? "medium"
              : "low";
      }
      if (Array.isArray(normalizedClaim.evidence)) {
        normalizedClaim.evidence = normalizedClaim.evidence.slice(0, 12);
      }
    }
    const candidates = (observation as Record<string, unknown>)
      .catalogCandidates;
    if (Array.isArray(candidates)) {
      (observation as Record<string, unknown>).catalogCandidates =
        candidates.slice(0, 5);
    }
  }
  return analysis;
}

export function combineCaptureWarnings(
  ...sources: Array<readonly string[] | undefined>
): string[] {
  return [
    ...new Set(
      sources
        .flatMap((warnings) => warnings ?? [])
        .map((warning) => warning.trim())
        .filter(Boolean),
    ),
  ].slice(0, 20);
}

export class GrokShelfReasoner implements ShelfReasoner {
  readonly provider = "xai";
  readonly model: string;

  constructor(
    private readonly options: {
      apiKey?: string;
      model?: string;
      fetch?: typeof fetch;
    } = {},
  ) {
    this.model = options.model ?? "grok-4.5";
  }

  async analyze(
    input: Parameters<ShelfReasoner["analyze"]>[0],
  ): Promise<ShelfAudit> {
    if (!this.options.apiKey) {
      throw new ReasoningError(
        "XAI_API_KEY is required for Grok shelf analysis.",
        "AI_PROVIDER_NOT_CONFIGURED",
      );
    }
    const images = await Promise.all(
      input.frames.map(async (frame) => {
        if (!frame.filePath) {
          throw new ReasoningError(
            "Evidence frame is unavailable.",
            "AI_PROVIDER_FAILED",
          );
        }
        const image = await readFile(frame.filePath);
        return {
          type: "image_url",
          image_url: {
            url: `data:image/png;base64,${image.toString("base64")}`,
            detail: "high",
          },
        };
      }),
    );
    const catalog = (input.assortment ?? []).map((item) => ({
      productId: item.productId,
      brand: item.brand,
      product: item.product,
      variant: item.variant,
      size: item.size,
    }));
    const prompt = `Read this retail shelf conservatively. Return JSON only, with no Markdown. The required top-level object is {schemaVersion:"1.0",captureQuality:{status,warnings},observations,notes}. captureQuality.status MUST be usable, degraded, or unusable. Every observation MUST contain observationId, matchLevel (exact_sku|product_family|brand_only|unknown), brand, product, variant, sizeOrPack, facings, shelfPosition, and catalogCandidates. Every claim MUST contain value, status, confidence, confidenceLevel, reason, and evidence. Valid claim statuses are observed, inferred, uncertain, not_observable, not_applicable. confidenceLevel MUST be low for confidence below .5, medium for .5 through below .8, high for .8 or above. For not_observable or not_applicable, value MUST be null. shelfPosition.value must be top, eye_level, waist_level, bottom, endcap, or unknown. evidence is an array of {frameId,timestampMs,description}, using only supplied frame IDs. catalogCandidates is an array of {productId,score,reason}; use only supplied catalog productIds. Always include every field, using null plus not_observable when the footage cannot support a read. Never invent unreadable labels, SKU matches, or out-of-stocks. Catalog: ${JSON.stringify(catalog)}. Frames: ${JSON.stringify(input.frames.map(({ frameId, timestampMs }) => ({ frameId, timestampMs })))}.`;
    let response: Response;
    try {
      response = await (this.options.fetch ?? fetch)(
        "https://api.x.ai/v1/chat/completions",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.options.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: this.model,
            temperature: 0,
            response_format: {
              type: "json_schema",
              json_schema: {
                name: "shelf_audit_observation",
                strict: true,
                schema: rawShelfAnalysisJsonSchema,
              },
            },
            messages: [
              {
                role: "user",
                content: [{ type: "text", text: prompt }, ...images],
              },
            ],
          }),
        },
      );
    } catch {
      throw new ReasoningError(
        "Grok could not be reached.",
        "AI_PROVIDER_FAILED",
      );
    }
    if (!response.ok) {
      throw new ReasoningError(
        `Grok analysis failed (${response.status}).`,
        "AI_PROVIDER_FAILED",
      );
    }
    let responseContent = "";
    try {
      const body = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      responseContent = body.choices?.[0]?.message?.content ?? "";
      const candidate = JSON.parse(
        responseContent
          .trim()
          .replace(/^```(?:json)?\s*/i, "")
          .replace(/\s*```$/, ""),
      ) as {
        captureQuality?: { status?: string };
        notes?: unknown;
      };
      const analysis = RawShelfAnalysisSchema.parse(
        normalizeProviderOutput(candidate),
      );
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
          status: analysis.captureQuality.status,
          warnings: combineCaptureWarnings(
            analysis.captureQuality.warnings,
            input.metadata.warnings,
            input.qualityWarnings,
            input.detector?.warnings,
          ),
        },
        observations: analysis.observations,
        outOfStocks: (input.assortment ?? [])
          .filter((item) => item.expectedPresence)
          .map((item) => ({
            expectedProductId: item.productId,
            status: "not_determinable",
            coverage: "unknown",
            reason:
              "The selected media does not establish complete coverage or an empty facing.",
            evidence: [],
          })),
        insights: [],
        notes: analysis.notes,
        provenance: {
          pipelineVersion: "grok-v1",
          provider: this.provider,
          model: this.model,
          promptVersion: "shelf-audit-v1",
          ...(input.detector
            ? { detectorVersion: input.detector.version }
            : {}),
        },
      });
    } catch (error) {
      console.error("Invalid Grok shelf-audit response", {
        error: error instanceof Error ? error.message : "Unknown error",
        responseContent: responseContent.slice(0, 4_000),
      });
      const detail = error instanceof Error ? ` ${error.message}` : "";
      throw new ReasoningError(
        `Grok returned an invalid shelf-audit response.${detail}`,
        "AI_PROVIDER_INVALID_RESPONSE",
      );
    }
  }
}
