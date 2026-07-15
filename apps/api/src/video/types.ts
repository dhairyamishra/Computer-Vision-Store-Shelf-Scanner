export type VideoMetadata = {
  durationMs: number;
  width: number;
  height: number;
  frameRate: number | null;
  rotationDegrees: number;
  warnings: string[];
};

export type CandidateFrame = {
  frameId: string;
  timestampMs: number;
  fileName: string;
  /** Absolute local path; never expose this value to API consumers. */
  filePath?: string;
};

export interface VideoProcessor {
  inspect(inputPath: string): Promise<VideoMetadata>;
  extractFrames(
    inputPath: string,
    options: { outputDirectory: string },
  ): Promise<CandidateFrame[]>;
}
