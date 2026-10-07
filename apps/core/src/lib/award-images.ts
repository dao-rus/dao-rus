import sharp from "sharp";
import { AwardValidationError } from "./awards";
export async function prepareAwardImages(file: File) {
    if (!file.size || file.size > 5 * 1024 * 1024)
        throw new AwardValidationError("Image must be at most 5 MB");
    const input = Buffer.from(await file.arrayBuffer());
    try {
        const image = sharp(input, { limitInputPixels: 16000000, animated: false });
        const metadata = await image.metadata();
        if (!metadata.format || !["png", "jpeg", "webp"].includes(metadata.format))
            throw new Error("Unsupported image");
        const original = await image.rotate().resize(1200, 1200, { fit: "inside", withoutEnlargement: true }).png().toBuffer();
        const thumbnail = await sharp(original).resize(48, 48, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
        if (original.length > 5242880)
            throw new Error("Image too large");
        return { original, thumbnail };
    }
    catch {
        throw new AwardValidationError("Use a valid PNG, JPEG or WebP image");
    }
}
