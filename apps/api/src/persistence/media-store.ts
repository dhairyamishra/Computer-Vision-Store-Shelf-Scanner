import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, extname, isAbsolute, relative, resolve } from "node:path";

const videoExtensionsByMimeType: Readonly<Record<string, string>> = {
  "video/mp4": ".mp4",
  "video/quicktime": ".mov",
  "video/webm": ".webm",
};

export type SaveSourceVideoInput = {
  originalFilename: string;
  mimeType: string;
  bytes: Uint8Array;
};

export type StoredMedia = {
  mediaPath: string;
  originalFilename: string;
  mimeType: string;
  byteLength: number;
};

export interface MediaStore {
  saveSourceVideo(input: SaveSourceVideoInput): Promise<StoredMedia>;
  resolveMediaPath(mediaPath: string): Promise<string>;
}

export class MediaStoreError extends Error {
  constructor(
    message: string,
    readonly code:
      "MEDIA_PATH_INVALID" | "MEDIA_TYPE_UNSUPPORTED" | "MEDIA_TOO_LARGE",
  ) {
    super(message);
    this.name = "MediaStoreError";
  }
}

export class LocalMediaStore implements MediaStore {
  private readonly directory: string;

  constructor(
    private readonly options: { directory: string; maxBytes: number },
  ) {
    this.directory = resolve(options.directory);
  }

  async saveSourceVideo(input: SaveSourceVideoInput): Promise<StoredMedia> {
    const extension = videoExtensionsByMimeType[input.mimeType];
    if (!extension) {
      throw new MediaStoreError(
        `Unsupported video MIME type '${input.mimeType}'.`,
        "MEDIA_TYPE_UNSUPPORTED",
      );
    }
    if (input.bytes.byteLength > this.options.maxBytes) {
      throw new MediaStoreError(
        `Video is larger than the ${this.options.maxBytes}-byte limit.`,
        "MEDIA_TOO_LARGE",
      );
    }

    const mediaPath = `uploads/${randomUUID()}${extension}`;
    const destination = await this.resolveMediaPath(mediaPath);
    await mkdir(resolve(this.directory, "uploads"), { recursive: true });
    await writeFile(destination, input.bytes);

    return {
      mediaPath,
      originalFilename: basename(input.originalFilename),
      mimeType: input.mimeType,
      byteLength: input.bytes.byteLength,
    };
  }

  async resolveMediaPath(mediaPath: string): Promise<string> {
    if (
      !mediaPath ||
      isAbsolute(mediaPath) ||
      extname(mediaPath) === "" ||
      mediaPath.split(/[\\/]/).includes("..")
    ) {
      throw new MediaStoreError(
        "Media path is outside the managed media directory.",
        "MEDIA_PATH_INVALID",
      );
    }

    const resolvedPath = resolve(this.directory, mediaPath);
    const pathFromRoot = relative(this.directory, resolvedPath);
    if (
      pathFromRoot === "" ||
      pathFromRoot.startsWith("..") ||
      isAbsolute(pathFromRoot)
    ) {
      throw new MediaStoreError(
        "Media path is outside the managed media directory.",
        "MEDIA_PATH_INVALID",
      );
    }

    return resolvedPath;
  }
}
