import { readFile } from "node:fs/promises";

import {
  RawShelfAnalysisSchema,
  SHELF_AUDIT_SCHEMA_VERSION,
  ShelfAuditSchema,
  type ShelfAudit,
} from "@shelf-audit/contracts";

import type { ShelfReasoner } from "./fixture-shelf-reasoner.js";

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
    const prompt = `Read this retail shelf conservatively. Return JSON only with schemaVersion "1.0", captureQuality {status,warnings}, observations, and notes. Each observation needs observationId, matchLevel (exact_sku|product_family|brand_only|unknown), brand/product/variant/sizeOrPack string claims, facings integer claim, shelfPosition claim, and catalogCandidates. Claims need value, status (observed|inferred|uncertain|not_observable|not_applicable), confidence (0-1), confidenceLevel (low <.5, medium <.8, high >=.8), reason, and evidence [{frameId,timestampMs,description}]. Use only the catalog productIds. Never invent unreadable labels, SKU matches, or out-of-stocks. Catalog: ${JSON.stringify(catalog)}. Frames: ${JSON.stringify(input.frames.map(({ frameId, timestampMs }) => ({ frameId, timestampMs })))}.`;
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
            response_format: { type: "json_object" },
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
      if (candidate.captureQuality?.status === "ok") {
        candidate.captureQuality.status = "usable";
      }
      if (typeof candidate.notes === "string") {
        candidate.notes = [candidate.notes.slice(0, 20)];
      }
      const analysis = RawShelfAnalysisSchema.parse(candidate);
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
          warnings: [
            ...new Set([
              ...analysis.captureQuality.warnings,
              ...input.metadata.warnings,
              ...(input.qualityWarnings ?? []),
              ...(input.detector?.warnings ?? []),
            ]),
          ],
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
      throw new ReasoningError(
        "Grok returned an invalid shelf-audit response.",
        "AI_PROVIDER_INVALID_RESPONSE",
      );
    }
  }
}
