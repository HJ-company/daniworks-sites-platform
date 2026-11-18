/** Longest edge sent to the api. The Worker accepts up to 3 MP; phone originals are 12 MP or more. */
export const MAX_EDGE = 1600;

/**
 * Downsizes a photo in the browser before upload (EXIF orientation applied by the decoder), so
 * large phone originals never reach the Worker's 128 MB isolate.
 */
export async function resizeForUpload(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("이미지를 처리하지 못했습니다");
  context.fillStyle = "#fff"; // transparent PNGs become white, as the api does
  context.fillRect(0, 0, width, height);
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("이미지를 처리하지 못했습니다"))), "image/jpeg", 0.9),
  );
}
