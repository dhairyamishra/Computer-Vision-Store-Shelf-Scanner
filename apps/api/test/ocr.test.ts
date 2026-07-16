import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  parseTesseractTsv,
  TesseractOcrService,
  type OcrProcessRunner,
} from "../src/perception/index.js";
import type { SelectedFrame } from "../src/video/frame-selector.js";

const tsv = `level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext
5\t1\t1\t1\t1\t1\t10\t10\t80\t20\t95.4\tSALE
5\t1\t1\t1\t1\t2\t95\t10\t60\t20\t88.1\t$4.99
`;

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function usableFrame(): Promise<SelectedFrame> {
  const directory = await mkdtemp(join(tmpdir(), "shelf-audit-ocr-test-"));
  directories.push(directory);
  const path = join(directory, "frame.png");
  await sharp({
    create: { width: 640, height: 960, channels: 3, background: "white" },
  })
    .png()
    .toFile(path);
  return {
    frameId: "frame-1",
    timestampMs: 0,
    fileName: "frame.png",
    filePath: path,
    selection: {
      sharpness: 0.1,
      brightness: 0.5,
      clipping: 0,
      entropy: 0.5,
      score: 0.8,
      reasons: ["selected for full-duration coverage"],
    },
  };
}

describe("local Tesseract OCR", () => {
  it("parses only confident TSV words and bounds their text", () => {
    expect(parseTesseractTsv(tsv)).toEqual({
      text: "SALE $4.99",
      confidence: 92,
    });
    expect(
      parseTesseractTsv(
        "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n5\t1\t1\t1\t1\t1\t0\t0\t1\t1\t20\tnoise\n",
      ),
    ).toBeNull();
    expect(
      parseTesseractTsv(
        "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n5\t1\t1\t1\t1\t1\t0\t0\t1\t1\t95\tA\n5\t1\t1\t1\t1\t2\t0\t0\t1\t1\t95\tHUGGIES\n",
      ),
    ).toEqual({ text: "HUGGIES", confidence: 95 });
  });

  it("preprocesses a bounded deterministic crop set and records evidence", async () => {
    const runProcess = vi.fn<OcrProcessRunner>(async (_command, args) => {
      if (args[0] === "--version") {
        return { stdout: "tesseract 5.5.0\n", stderr: "" };
      }
      return { stdout: tsv, stderr: "" };
    });
    const service = new TesseractOcrService({ runProcess });

    const result = await service.extract([await usableFrame()]);

    expect(runProcess).toHaveBeenCalledTimes(4);
    expect(result).toMatchObject({
      status: "available",
      providerVersion: "tesseract 5.5.0",
    });
    expect(result.evidence).toHaveLength(3);
    expect(result.evidence[0]).toMatchObject({
      frameId: "frame-1",
      text: "SALE $4.99",
      confidence: 92,
    });
  });

  it("makes a missing executable unavailable without throwing", async () => {
    const service = new TesseractOcrService({
      runProcess: async () => {
        throw new Error("spawn tesseract ENOENT");
      },
    });

    await expect(service.extract([await usableFrame()])).resolves.toMatchObject(
      {
        status: "unavailable",
        evidence: [],
        unavailableReason: "spawn tesseract ENOENT",
      },
    );
  });

  it("falls back to PATH when the optional executable setting is blank", async () => {
    const runProcess = vi.fn<OcrProcessRunner>(async () => ({
      stdout: "tesseract 5.5.0\n",
      stderr: "",
    }));
    const service = new TesseractOcrService({
      executablePath: "",
      runProcess,
    });

    await service.extract([await usableFrame()]);

    expect(runProcess).toHaveBeenCalledWith(
      "tesseract",
      ["--version"],
      expect.any(Number),
    );
  });

  it("skips locally degraded evidence without starting Tesseract", async () => {
    const runProcess = vi.fn<OcrProcessRunner>();
    const frame = await usableFrame();
    frame.selection.reasons.push("blurry");
    const service = new TesseractOcrService({ runProcess });

    await expect(service.extract([frame])).resolves.toMatchObject({
      status: "available",
      skippedFrames: [{ frameId: "frame-1" }],
      evidence: [],
    });
    expect(runProcess).not.toHaveBeenCalled();
  });
});
