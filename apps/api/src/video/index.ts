export {
  FfmpegVideoProcessor,
  extractFixtureFrames,
  VideoProcessingError,
} from "./ffmpeg-video-processor.js";
export {
  scoreFrameQuality,
  selectQualityAwareFrames,
  selectVideoEvidenceFrames,
  selectRepresentativeFrames,
  type FrameQualityScore,
  type SelectedFrame,
} from "./frame-selector.js";
export type { CandidateFrame, VideoMetadata, VideoProcessor } from "./types.js";
