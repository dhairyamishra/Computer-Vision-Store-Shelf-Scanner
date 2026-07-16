import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import sharp from "sharp";

import type { EvidenceRef } from "@shelf-audit/contracts";
import type { SelectedFrame } from "../video/frame-selector.js";

const OCR_TIMEOUT_MS = 4_000;
const MAX_TEXT_LENGTH = 240;
const MIN_CONFIDENCE = 70;
const MIN_CROP_WIDTH = 160;
const MIN_CROP_HEIGHT = 48;

export type OcrEvidence = EvidenceRef & {
  text: string;
  confidence: number;
  crop: "full_frame" | "upper_shelf_edge" | "lower_shelf_edge";
};

export type OcrRunResult = {
  status: "available" | "unavailable";
  providerVersion?: string;
  evidence: OcrEvidence[];
  skippedFrames: Array<{ frameId: string; reason: string }>;
  unavailableReason?: string;
};

export interface OcrService {
  extract(frames: readonly SelectedFrame[]): Promise<OcrRunResult>;
}

export type OcrProcessResult = { stdout: string; stderr: string };
export type OcrProcessRunner = (
  command: string,
  args: string[],
  timeoutMs: number,
) => Promise<OcrProcessResult>;

type CropDefinition = {
  name: OcrEvidence["crop"];
  region: NonNullable<EvidenceRef["region"]>;
  pageSegmentationMode: number;
};

const cropDefinitions: CropDefinition[] = [
  {
    name: "full_frame",
    region: { xMin: 0, yMin: 0, xMax: 1, yMax: 1 },
    pageSegmentationMode: 11,
  },
  {
    name: "upper_shelf_edge",
    region: { xMin: 0, yMin: 0.38, xMax: 1, yMax: 0.6 },
    pageSegmentationMode: 6,
  },
  {
    name: "lower_shelf_edge",
    region: { xMin: 0, yMin: 0.68, xMax: 1, yMax: 0.9 },
    pageSegmentationMode: 6,
  },
];

function hasFrameQualityFailure(frame: SelectedFrame): boolean {
  return frame.selection.reasons.some((reason) =>
    ["blurry", "underexposed", "overexposed", "high clipping"].includes(reason),
  );
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, MAX_TEXT_LENGTH);
}

function isUsefulOcrToken(value: string): boolean {
  const letterCount = (value.match(/[a-z]/gi) ?? []).length;
  return letterCount >= 3 || /^\$?\d+(?:[.,]\d{2})$/.test(value);
}

export function parseTesseractTsv(output: string): {
  text: string;
  confidence: number;
} | null {
  const words = output
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.split("\t"))
    .filter((columns) => columns.length >= 12)
    .map((columns) => ({
      confidence: Number(columns[10]),
      text: normalizeText(columns.slice(11).join("\t")),
    }))
    .filter(
      (word) =>
        word.text.length > 0 &&
        Number.isFinite(word.confidence) &&
        word.confidence >= MIN_CONFIDENCE &&
        isUsefulOcrToken(word.text),
    );
  if (words.length === 0) {
    return null;
  }
  const text = normalizeText(words.map((word) => word.text).join(" "));
  if (!text) {
    return null;
  }
  return {
    text,
    confidence: Math.round(
      words.reduce((total, word) => total + word.confidence, 0) / words.length,
    ),
  };
}

export const spawnOcrProcess: OcrProcessRunner = (command, args, timeoutMs) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error("Tesseract timed out."));
    }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(stderr || `Tesseract exited with code ${code}.`));
      }
    });
  });

export class TesseractOcrService implements OcrService {
  private readonly executablePath: string;
  private readonly runProcess: OcrProcessRunner;

  constructor(
    options: { executablePath?: string; runProcess?: OcrProcessRunner } = {},
  ) {
    this.executablePath =
      (options.executablePath ?? process.env.TESSERACT_PATH) || "tesseract";
    this.runProcess = options.runProcess ?? spawnOcrProcess;
  }

  async extract(frames: readonly SelectedFrame[]): Promise<OcrRunResult> {
    const skippedFrames = frames
      .filter(hasFrameQualityFailure)
      .map((frame) => ({
        frameId: frame.frameId,
        reason: "Skipped local OCR because the selected frame is degraded.",
      }));
    const usableFrames = frames.filter(
      (frame) => frame.filePath && !hasFrameQualityFailure(frame),
    );
    if (usableFrames.length === 0) {
      return { status: "available", evidence: [], skippedFrames };
    }

    let providerVersion: string;
    try {
      const version = await this.runProcess(
        this.executablePath,
        ["--version"],
        OCR_TIMEOUT_MS,
      );
      providerVersion =
        normalizeText(version.stdout.split(/\r?\n/)[0]) || "tesseract";
    } catch (error) {
      return {
        status: "unavailable",
        evidence: [],
        skippedFrames,
        unavailableReason:
          error instanceof Error ? error.message : "Tesseract is unavailable.",
      };
    }

    const directory = await mkdtemp(join(tmpdir(), "shelf-audit-ocr-"));
    try {
      const evidence: OcrEvidence[] = [];
      for (const frame of usableFrames) {
        if (!frame.filePath) continue;
        const image = sharp(frame.filePath).rotate();
        const metadata = await image.metadata();
        if (!metadata.width || !metadata.height) continue;
        for (const crop of cropDefinitions) {
          const left = Math.round(crop.region.xMin * metadata.width);
          const top = Math.round(crop.region.yMin * metadata.height);
          const width = Math.round(
            (crop.region.xMax - crop.region.xMin) * metadata.width,
          );
          const height = Math.round(
            (crop.region.yMax - crop.region.yMin) * metadata.height,
          );
          if (width < MIN_CROP_WIDTH || height < MIN_CROP_HEIGHT) continue;
          const cropPath = join(directory, `${frame.frameId}-${crop.name}.png`);
          await image
            .clone()
            .extract({ left, top, width, height })
            .resize({ width: Math.min(2_000, width * 2) })
            .grayscale()
            .normalise()
            .sharpen()
            .png()
            .toFile(cropPath);
          try {
            const result = await this.runProcess(
              this.executablePath,
              [
                cropPath,
                "stdout",
                "--psm",
                String(crop.pageSegmentationMode),
                "-l",
                "eng",
                "tsv",
              ],
              OCR_TIMEOUT_MS,
            );
            const parsed = parseTesseractTsv(result.stdout);
            if (parsed) {
              evidence.push({
                frameId: frame.frameId,
                timestampMs: frame.timestampMs,
                region: crop.region,
                description: `Local Tesseract OCR (${crop.name.replaceAll("_", " ")}).`,
                crop: crop.name,
                ...parsed,
              });
            }
          } catch {
            // Individual crops are optional evidence and must not fail an audit.
          }
        }
      }
      return { status: "available", providerVersion, evidence, skippedFrames };
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
}
