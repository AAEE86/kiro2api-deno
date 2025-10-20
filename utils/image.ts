export const SupportedImageFormats: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
};

export const MaxImageSize = 20 * 1024 * 1024; // 20MB

export function detectImageFormat(data: Uint8Array): string {
  if (data.length < 12) throw new Error("文件太小，无法检测格式");

  // JPEG
  if (data.length >= 2 && data[0] === 0xFF && data[1] === 0xD8) return "image/jpeg";

  // PNG
  if (data.length >= 8 && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4E && data[3] === 0x47 &&
      data[4] === 0x0D && data[5] === 0x0A && data[6] === 0x1A && data[7] === 0x0A) return "image/png";

  // GIF
  if (data.length >= 6 && data[0] === 0x47 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x38 &&
      (data[4] === 0x37 || data[4] === 0x39) && data[5] === 0x61) return "image/gif";

  // WebP
  if (data.length >= 12 && data[0] === 0x52 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x46 &&
      data[8] === 0x57 && data[9] === 0x45 && data[10] === 0x42 && data[11] === 0x50) return "image/webp";

  // BMP
  if (data.length >= 2 && data[0] === 0x42 && data[1] === 0x4D) return "image/bmp";

  throw new Error("不支持的图片格式");
}

export function isSupportedImageFormat(mediaType: string): boolean {
  return getImageFormatFromMediaType(mediaType) !== "";
}

export function getImageFormatFromMediaType(mediaType: string): string {
  const formats: Record<string, string> = {
    "image/jpeg": "jpeg",
    "image/png": "png",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/bmp": "bmp",
  };
  return formats[mediaType] || "";
}

export function parseDataURL(dataURL: string): { mediaType: string; base64Data: string } {
  const match = dataURL.match(/^data:([^;,]+)(;base64)?,(.+)$/);
  if (!match || match.length !== 4) throw new Error("无效的data URL格式");

  const mediaType = match[1];
  const isBase64 = match[2] === ";base64";
  const data = match[3];

  if (!isBase64) throw new Error("仅支持base64编码的data URL");
  if (!isSupportedImageFormat(mediaType)) throw new Error(`不支持的图片格式: ${mediaType}`);

  const decodedData = Uint8Array.from(atob(data), c => c.charCodeAt(0));

  if (decodedData.length > MaxImageSize) {
    throw new Error(`图片数据过大: ${decodedData.length} 字节，最大支持 ${MaxImageSize} 字节`);
  }

  const detectedType = detectImageFormat(decodedData);
  if (detectedType !== mediaType) {
    throw new Error(`图片格式不匹配: 声明为 ${mediaType}，实际为 ${detectedType}`);
  }

  return { mediaType, base64Data: data };
}
