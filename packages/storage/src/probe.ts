import ffmpeg from "fluent-ffmpeg";
import ffprobeStatic from "ffprobe-static";
import sharp from "sharp";

ffmpeg.setFfprobePath(ffprobeStatic.path);

export interface ImageMetadata {
  width: number | null;
  height: number | null;
}

export interface VideoMetadata {
  width: number | null;
  height: number | null;
  durationSec: number | null;
}

export async function probeImage(buffer: Buffer): Promise<ImageMetadata> {
  const metadata = await sharp(buffer).metadata();
  return { width: metadata.width ?? null, height: metadata.height ?? null };
}

export function probeVideo(filePath: string): Promise<VideoMetadata> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, data) => {
      if (err) {
        reject(err);
        return;
      }
      const videoStream = data.streams.find((s) => s.codec_type === "video");
      resolve({
        width: videoStream?.width ?? null,
        height: videoStream?.height ?? null,
        durationSec: data.format.duration ?? null,
      });
    });
  });
}
