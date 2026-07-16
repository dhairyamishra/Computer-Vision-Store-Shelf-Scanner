import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Fastify, { type FastifyInstance } from "fastify";
import multipart from "@fastify/multipart";
import sharp from "sharp";

import {
  DEFAULT_DATA_DIRECTORY,
  LocalMediaStore,
  MediaStoreError,
  PGliteAuditRepository,
  createDatabase,
  createLocalDatabase,
  migrateDatabase,
  seedDemoData,
  type AuditRepository,
  type MediaStore,
} from "../persistence/index.js";
import {
  FixtureShelfReasoner,
  GrokShelfReasoner,
  ReasoningError,
  type ShelfReasoner,
} from "../reasoning/index.js";
import {
  FfmpegVideoProcessor,
  VideoProcessingError,
  selectQualityAwareFrames,
  type VideoProcessor,
} from "../video/index.js";
import type { CandidateFrame, VideoMetadata } from "../video/types.js";
import {
  createDetectionCrops,
  DEFAULT_DETECTOR_MODEL,
  DetectorUnavailableError,
  runLocalDetection,
  TransformersLocalDetector,
  type LocalDetector,
} from "../perception/index.js";
import { SHELF_AUDIT_UI } from "./ui.js";

type ErrorPayload = {
  error: { code: string; message: string };
  auditId?: string;
};

export type CreateApiServerOptions = {
  mode?: "local" | "test";
  maxUploadBytes?: number;
  maxDurationMs?: number;
  videoProcessor?: VideoProcessor;
  reasoner?: ShelfReasoner;
  localDetector?: LocalDetector;
};

const defaultMaxUploadBytes = 100 * 1024 * 1024;
const defaultMaxDurationMs = 120_000;

function errorPayload(
  code: string,
  message: string,
  auditId?: string,
): ErrorPayload {
  return { error: { code, message }, ...(auditId ? { auditId } : {}) };
}

async function findAccount(repository: AuditRepository, accountId: string) {
  return (await repository.listAccounts()).find(
    (account) => account.id === accountId,
  );
}

function stageDurations(startedAt: number): Record<string, number> {
  return { totalMs: Math.max(0, Date.now() - startedAt) };
}

function isSupportedImage(mimeType: string): boolean {
  return ["image/jpeg", "image/png", "image/webp"].includes(mimeType);
}

async function extractImageFrame(
  sourcePath: string,
  outputDirectory: string,
): Promise<{ metadata: VideoMetadata; frames: CandidateFrame[] }> {
  const image = sharp(sourcePath).rotate();
  const sourceMetadata = await image.metadata();
  if (!sourceMetadata.width || !sourceMetadata.height) {
    throw new VideoProcessingError(
      "Upload is not a usable image.",
      "VIDEO_INVALID",
    );
  }

  const fileName = "frame-000000000.png";
  const filePath = join(outputDirectory, fileName);
  await image.png().toFile(filePath);
  return {
    metadata: {
      durationMs: 1_000,
      width: sourceMetadata.width,
      height: sourceMetadata.height,
      frameRate: null,
      rotationDegrees: 0,
      warnings: ["A still image was analyzed as one evidence frame."],
    },
    frames: [{ frameId: "frame-1", timestampMs: 0, fileName, filePath }],
  };
}

async function createDependencies(options: CreateApiServerOptions): Promise<{
  repository: AuditRepository;
  mediaStore: MediaStore;
  close: () => Promise<void>;
}> {
  const isTest = options.mode === "test";
  const database = isTest
    ? await createDatabase({ mode: "memory" })
    : await createLocalDatabase();
  await migrateDatabase(database);
  await seedDemoData(database);
  const repository = new PGliteAuditRepository(database);
  await repository.recoverAbandonedAudits();

  const mediaDirectory = isTest
    ? await mkdtemp(join(tmpdir(), "shelf-audit-api-"))
    : DEFAULT_DATA_DIRECTORY;
  return {
    repository,
    mediaStore: new LocalMediaStore({
      directory: mediaDirectory,
      maxBytes: options.maxUploadBytes ?? defaultMaxUploadBytes,
    }),
    close: async () => {
      await database.close();
      if (isTest) {
        await rm(mediaDirectory, { recursive: true, force: true });
      }
    },
  };
}

export async function createApiServer(
  options: CreateApiServerOptions = {},
): Promise<FastifyInstance> {
  const dependencies = await createDependencies(options);
  const videoProcessor =
    options.videoProcessor ??
    new FfmpegVideoProcessor({
      ffmpegPath: process.env.FFMPEG_PATH || undefined,
      ffprobePath: process.env.FFPROBE_PATH || undefined,
    });
  const reasoner =
    options.reasoner ??
    (options.mode === "test"
      ? new FixtureShelfReasoner()
      : new GrokShelfReasoner({
          apiKey: process.env.XAI_API_KEY,
          model: process.env.XAI_MODEL,
        }));
  const localDetector =
    options.localDetector ??
    (options.mode === "test"
      ? {
          version: DEFAULT_DETECTOR_MODEL,
          detect: async () => {
            throw new DetectorUnavailableError(
              "Detector loading is disabled in test mode.",
            );
          },
        }
      : new TransformersLocalDetector({
          cacheDirectory: join(DEFAULT_DATA_DIRECTORY, "model-cache"),
        }));
  const maxUploadBytes = options.maxUploadBytes ?? defaultMaxUploadBytes;
  const maxDurationMs = options.maxDurationMs ?? defaultMaxDurationMs;
  const server = Fastify({ logger: false });

  await server.register(multipart, {
    limits: { files: 1, fileSize: maxUploadBytes },
  });

  server.addHook("onClose", async () => {
    await dependencies.close();
  });

  server.get("/health", async () => ({ status: "ok" }));

  server.get("/", async (_request, reply) =>
    reply.type("text/html; charset=utf-8").send(SHELF_AUDIT_UI),
  );

  server.get("/accounts", async () => ({
    accounts: await dependencies.repository.listAccounts(),
  }));

  server.get<{ Params: { auditId: string } }>(
    "/audits/:auditId",
    async (request, reply) => {
      try {
        return await dependencies.repository.getAudit(request.params.auditId);
      } catch {
        return reply
          .status(404)
          .send(errorPayload("AUDIT_NOT_FOUND", "Audit was not found."));
      }
    },
  );

  server.post("/audits", async (request, reply) => {
    if (!request.isMultipart()) {
      return reply
        .status(415)
        .send(
          errorPayload(
            "UNSUPPORTED_MEDIA_TYPE",
            "Use multipart/form-data with a video field.",
          ),
        );
    }

    let upload;
    try {
      upload = await request.file();
    } catch {
      return reply
        .status(413)
        .send(
          errorPayload("UPLOAD_TOO_LARGE", "Video exceeds the upload limit."),
        );
    }
    if (!upload || !["video", "media"].includes(upload.fieldname)) {
      return reply
        .status(400)
        .send(
          errorPayload("MEDIA_REQUIRED", "A photo or video field is required."),
        );
    }

    let bytes: Buffer;
    try {
      bytes = await upload.toBuffer();
    } catch {
      return reply
        .status(413)
        .send(
          errorPayload("UPLOAD_TOO_LARGE", "Media exceeds the upload limit."),
        );
    }
    if (upload.file.truncated || bytes.byteLength > maxUploadBytes) {
      return reply
        .status(413)
        .send(
          errorPayload("UPLOAD_TOO_LARGE", "Media exceeds the upload limit."),
        );
    }

    const accountField = Array.isArray(upload.fields.accountId)
      ? upload.fields.accountId[0]
      : upload.fields.accountId;
    const accountId =
      accountField?.type === "field" ? accountField.value : undefined;
    if (typeof accountId !== "string") {
      return reply
        .status(400)
        .send(errorPayload("ACCOUNT_REQUIRED", "accountId is required."));
    }
    const account = await findAccount(dependencies.repository, accountId);
    if (!account) {
      return reply
        .status(404)
        .send(errorPayload("ACCOUNT_NOT_FOUND", "Account was not found."));
    }

    let storedVideo;
    try {
      storedVideo = await dependencies.mediaStore.saveSourceVideo({
        originalFilename: upload.filename,
        mimeType: upload.mimetype,
        bytes,
      });
    } catch (error) {
      if (
        error instanceof MediaStoreError &&
        error.code === "MEDIA_TOO_LARGE"
      ) {
        return reply
          .status(413)
          .send(errorPayload("UPLOAD_TOO_LARGE", error.message));
      }
      return reply
        .status(415)
        .send(
          errorPayload("MEDIA_TYPE_UNSUPPORTED", "Unsupported media type."),
        );
    }

    const audit = await dependencies.repository.createAudit({
      id: randomUUID(),
      accountId: account.id,
      sourceVideoPath: storedVideo.mediaPath,
      provider: reasoner.provider ?? "unknown",
      model: reasoner.model ?? "unknown",
    });
    const startedAt = Date.now();

    try {
      await dependencies.repository.transitionAudit(audit.id, "uploading");
      await dependencies.repository.transitionAudit(audit.id, "uploaded");
      await dependencies.repository.transitionAudit(
        audit.id,
        "extracting_frames",
      );
      const sourcePath = await dependencies.mediaStore.resolveMediaPath(
        storedVideo.mediaPath,
      );
      const isImage = isSupportedImage(upload.mimetype);
      const inspectedMetadata = isImage
        ? null
        : await videoProcessor.inspect(sourcePath);
      if (inspectedMetadata && inspectedMetadata.durationMs > maxDurationMs) {
        throw new VideoProcessingError(
          `Video duration exceeds the ${maxDurationMs}-ms limit.`,
          "VIDEO_TOO_LONG",
        );
      }
      const frameDirectory =
        await dependencies.mediaStore.createAuditFrameDirectory(audit.id);
      const { metadata, frames } = isImage
        ? await extractImageFrame(sourcePath, frameDirectory)
        : {
            metadata: inspectedMetadata as VideoMetadata,
            frames: await videoProcessor.extractFrames(sourcePath, {
              outputDirectory: frameDirectory,
            }),
          };
      await dependencies.repository.transitionAudit(
        audit.id,
        "selecting_frames",
      );
      const selectedFrames = await selectQualityAwareFrames(frames);
      await dependencies.repository.transitionAudit(
        audit.id,
        "local_detection",
      );
      const detector = await runLocalDetection(localDetector, selectedFrames);
      const crops = detector.available
        ? await createDetectionCrops(
            selectedFrames,
            detector.detections,
            join(frameDirectory, "..", "crops"),
          )
        : [];
      await dependencies.repository.recordProcessingMetadata(audit.id, {
        frameSelection: selectedFrames.map((frame) => ({
          frameId: frame.frameId,
          timestampMs: frame.timestampMs,
          fileName: frame.fileName,
          selection: frame.selection,
        })),
        detector: {
          available: detector.available,
          version: detector.version,
          warnings: detector.warnings,
          detectionCount: detector.detections.length,
          crops,
        },
      });
      await dependencies.repository.transitionAudit(
        audit.id,
        "managed_reasoning",
      );
      const finalAudit = await reasoner.analyze({
        auditId: audit.id,
        account,
        assortment: await dependencies.repository.listAccountAssortment(
          account.id,
        ),
        sourceVideoPath: storedVideo.mediaPath,
        metadata,
        frames: selectedFrames,
        qualityWarnings: selectedFrames.flatMap((frame) =>
          frame.selection.reasons
            .filter(
              (reason) =>
                reason !== "temporal coverage" &&
                reason !== "best quality in temporal segment",
            )
            .map((reason) => `Frame ${frame.frameId}: ${reason}.`),
        ),
        detector,
      });
      await dependencies.repository.transitionAudit(audit.id, "grounding");
      await dependencies.repository.transitionAudit(audit.id, "persisting");
      const completed = await dependencies.repository.completeAudit(
        audit.id,
        finalAudit,
        stageDurations(startedAt),
      );
      return reply
        .status(201)
        .send({ auditId: completed.id, status: completed.status });
    } catch (error) {
      const code =
        error instanceof VideoProcessingError || error instanceof ReasoningError
          ? error.code
          : "VIDEO_PROCESSING_FAILED";
      const message =
        error instanceof Error ? error.message : "Audit processing failed.";
      await dependencies.repository.recordStageLatencies(
        audit.id,
        stageDurations(startedAt),
      );
      try {
        await dependencies.repository.transitionAudit(audit.id, "failed", {
          errorCode: code,
          errorMessage: message,
        });
      } catch {
        // Preserve the original processing error if a secondary persistence operation fails.
      }
      const statusCode =
        code === "VIDEO_TOO_LONG" || code === "VIDEO_INVALID"
          ? 422
          : code === "AI_PROVIDER_NOT_CONFIGURED"
            ? 503
            : 500;
      return reply
        .status(statusCode)
        .send(errorPayload(code, message, audit.id));
    }
  });

  return server;
}
