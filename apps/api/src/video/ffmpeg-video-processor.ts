import { mkdtemp, readdir, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

import ffmpegStatic from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";

import type { CandidateFrame, VideoMetadata, VideoProcessor } from "./types.js";

type FfprobeOutput = {
  format?: { duration?: string };
  streams?: Array<{
    codec_type?: string;
    width?: number;
    height?: number;
    duration?: string;
    r_frame_rate?: string;
    tags?: { rotate?: string };
    side_data_list?: Array<{ rotation?: number }>;
  }>;
};

export class VideoProcessingError extends Error {
  constructor(
    message: string,
    readonly code:
      "VIDEO_INVALID" | "VIDEO_TOO_LONG" | "VIDEO_PROCESSING_FAILED",
  ) {
    super(message);
    this.name = "VideoProcessingError";
  }
}

function parseFrameRate(value: string | undefined): number | null {
  if (!value) {
    return null;
  }
  const [numerator, denominator] = value.split("/").map(Number);
  if (
    !Number.isFinite(numerator) ||
    !Number.isFinite(denominator) ||
    denominator === 0
  ) {
    return null;
  }
  return numerator / denominator;
}

async function runProcess(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const process = spawn(command, args, { windowsHide: true });
    let standardOutput = "";
    let standardError = "";
    process.stdout.on("data", (chunk: Buffer) => {
      standardOutput += chunk.toString();
    });
    process.stderr.on("data", (chunk: Buffer) => {
      standardError += chunk.toString();
    });
    process.on("error", (error) => reject(error));
    process.on("close", (code) => {
      if (code === 0) {
        resolve(standardOutput);
      } else {
        reject(new Error(standardError || `Process exited with code ${code}.`));
      }
    });
  });
}

export class FfmpegVideoProcessor implements VideoProcessor {
  private readonly ffmpegPath: string;
  private readonly ffprobePath: string;

  constructor(options: { ffmpegPath?: string; ffprobePath?: string } = {}) {
    if (!options.ffmpegPath && !ffmpegStatic) {
      throw new VideoProcessingError(
        "FFmpeg is unavailable. Set FFMPEG_PATH to a valid executable.",
        "VIDEO_PROCESSING_FAILED",
      );
    }
    this.ffmpegPath = options.ffmpegPath ?? (ffmpegStatic as unknown as string);
    this.ffprobePath = options.ffprobePath ?? ffprobeStatic.path;
  }

  async inspect(inputPath: string): Promise<VideoMetadata> {
    let output: string;
    try {
      output = await runProcess(this.ffprobePath, [
        "-v",
        "error",
        "-show_format",
        "-show_streams",
        "-of",
        "json",
        inputPath,
      ]);
    } catch (error) {
      throw new VideoProcessingError(
        `Unable to inspect video: ${error instanceof Error ? error.message : "unknown error"}`,
        "VIDEO_PROCESSING_FAILED",
      );
    }

    let probe: FfprobeOutput;
    try {
      probe = JSON.parse(output) as FfprobeOutput;
    } catch {
      throw new VideoProcessingError(
        "FFprobe returned invalid metadata.",
        "VIDEO_INVALID",
      );
    }

    const stream = probe.streams?.find(
      (candidate) => candidate.codec_type === "video",
    );
    const durationSeconds = Number(probe.format?.duration ?? stream?.duration);
    if (
      !stream ||
      !Number.isFinite(durationSeconds) ||
      durationSeconds <= 0 ||
      !stream.width ||
      !stream.height
    ) {
      throw new VideoProcessingError(
        "Upload is not a usable video with duration and dimensions.",
        "VIDEO_INVALID",
      );
    }

    const rotationDegrees = Number(
      stream.tags?.rotate ?? stream.side_data_list?.[0]?.rotation ?? 0,
    );
    const warnings =
      rotationDegrees === 0
        ? []
        : [
            `Rotation metadata is ${rotationDegrees} degrees; FFmpeg autorotation is applied during extraction.`,
          ];

    return {
      durationMs: Math.round(durationSeconds * 1_000),
      width: stream.width,
      height: stream.height,
      frameRate: parseFrameRate(stream.r_frame_rate),
      rotationDegrees,
      warnings,
    };
  }

  async extractFrames(
    inputPath: string,
    options: { outputDirectory: string },
  ): Promise<CandidateFrame[]> {
    const metadata = await this.inspect(inputPath);
    const temporaryPattern = join(options.outputDirectory, "frame-%06d.png");
    try {
      await runProcess(this.ffmpegPath, [
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        inputPath,
        "-vf",
        "fps=2",
        "-y",
        temporaryPattern,
      ]);
    } catch (error) {
      throw new VideoProcessingError(
        `Unable to extract frames: ${error instanceof Error ? error.message : "unknown error"}`,
        "VIDEO_PROCESSING_FAILED",
      );
    }

    const extracted = (await readdir(options.outputDirectory))
      .filter((fileName) => /^frame-\d{6}\.png$/.test(fileName))
      .sort();
    if (extracted.length === 0) {
      throw new VideoProcessingError(
        "No frames could be extracted from the video.",
        "VIDEO_INVALID",
      );
    }

    return Promise.all(
      extracted.map(async (temporaryName, index) => {
        const timestampMs = Math.min(
          index * 500,
          Math.max(0, metadata.durationMs - 1),
        );
        const fileName = `frame-${timestampMs.toString().padStart(9, "0")}.png`;
        await rename(
          join(options.outputDirectory, temporaryName),
          join(options.outputDirectory, fileName),
        );
        return {
          frameId: `frame-${index + 1}`,
          timestampMs,
          fileName,
          filePath: join(options.outputDirectory, fileName),
        };
      }),
    );
  }
}

export async function extractFixtureFrames(inputPath: string): Promise<{
  metadata: VideoMetadata;
  frames: CandidateFrame[];
}> {
  const directory = await mkdtemp(join(tmpdir(), "shelf-audit-frames-"));
  const processor = new FfmpegVideoProcessor();
  try {
    const metadata = await processor.inspect(inputPath);
    const frames = await processor.extractFrames(inputPath, {
      outputDirectory: directory,
    });
    return { metadata, frames };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
