export {
  DEFAULT_DETECTOR_MODEL,
  DetectorUnavailableError,
  normalizeDetectionBox,
  runLocalDetection,
  TransformersLocalDetector,
  type DetectorRun,
  type LocalDetection,
  type LocalDetector,
  type NormalizedBox,
} from "./local-detector.js";
export { createDetectionCrops, type DetectionCrop } from "./crops.js";
