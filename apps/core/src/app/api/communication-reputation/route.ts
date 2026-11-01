import { NextResponse } from "next/server";

// Communication reputation is derived exclusively from Telegram hub reactions.
// Disable the legacy manual rating endpoint rather than permitting two sources.
export async function POST() {
  return new NextResponse("Communication ratings are recorded by the Telegram hub bot", { status: 410 });
}
