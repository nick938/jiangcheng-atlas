export const MAX_IMAGE_UPLOAD_BYTES = 5 * 1024 * 1024;
export const MAX_IMAGE_REQUEST_BYTES = MAX_IMAGE_UPLOAD_BYTES + 128 * 1024;

const imageTypes = {
  "image/jpeg": { extension: "jpg", magic: [[0xff, 0xd8, 0xff]] },
  "image/png": { extension: "png", magic: [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]] },
  "image/webp": { extension: "webp", magic: [[0x52, 0x49, 0x46, 0x46]] },
  "image/avif": { extension: "avif", magic: [[0x00, 0x00, 0x00], [0x66, 0x74, 0x79, 0x70]] },
} as const;

export type AllowedImageType = keyof typeof imageTypes;

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  return signature.every((byte, index) => bytes[index] === byte);
}

function isAllowedImageType(type: string): type is AllowedImageType {
  return type in imageTypes;
}

async function imageContentIsValid(file: File, type: AllowedImageType): Promise<boolean> {
  const bytes = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  if (type === "image/webp") {
    return startsWith(bytes, imageTypes[type].magic[0])
      && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
  }
  if (type === "image/avif") {
    return String.fromCharCode(...bytes.slice(4, 12)).includes("ftyp");
  }
  return imageTypes[type].magic.some((signature) => startsWith(bytes, signature));
}

export async function inspectUploadedImage(file: File): Promise<{
  contentType: AllowedImageType;
  extension: string;
} | null> {
  if (file.size <= 0 || file.size > MAX_IMAGE_UPLOAD_BYTES || !isAllowedImageType(file.type)) {
    return null;
  }
  if (!(await imageContentIsValid(file, file.type))) return null;
  return { contentType: file.type, extension: imageTypes[file.type].extension };
}
