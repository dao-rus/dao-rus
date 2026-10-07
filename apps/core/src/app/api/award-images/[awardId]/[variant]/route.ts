import { pool } from "@/lib/db";
import { id, AwardValidationError } from "@/lib/awards";
export async function GET(_request: Request, { params }: {
    params: Promise<{
        awardId: string;
        variant: string;
    }>;
}) {
    const { awardId, variant } = await params;
    if (variant !== "original" && variant !== "badge")
        return new Response("Not found", { status: 404 });
    try {
        const result = await pool.query(`SELECT ${variant === "badge" ? "thumbnail_data" : "image_data"} AS image FROM awards WHERE id=$1`, [id(awardId)]);
        if (!result.rows[0]?.image)
            return new Response("Not found", { status: 404 });
        return new Response(new Uint8Array(result.rows[0].image), { headers: { "Content-Type": "image/png", "X-Content-Type-Options": "nosniff", "Cache-Control": "public, max-age=31536000, immutable" } });
    }
    catch (error) {
        if (error instanceof AwardValidationError)
            return new Response("Not found", { status: 404 });
        throw error;
    }
}
