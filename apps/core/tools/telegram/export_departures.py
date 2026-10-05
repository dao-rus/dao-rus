"""Local, read-only departure archive export using the existing user session."""
import argparse
import asyncio
import json
import subprocess
from datetime import datetime, timezone

from telethon import TelegramClient
from telethon.tl import types
from export_roster import LOCAL_DIR, required_api_id, required_api_hash, utc_iso

CHANNEL = "@list_of_exites"


async def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--session", default=str(LOCAL_DIR / "mtproto-roster"))
    parser.add_argument("--ocr", help="Optional local tesseract executable; output is untrusted")
    parser.add_argument("--ocr-language", default="rus+eng")
    args = parser.parse_args()
    run_dir = LOCAL_DIR / ("departures-" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ"))
    run_dir.mkdir(parents=True, exist_ok=False)
    client = TelegramClient(args.session, required_api_id(), required_api_hash(), connection_retries=0)
    try:
        await client.connect()
        if not await client.is_user_authorized() or (await client.get_me()).bot:
            raise RuntimeError("An already authorized Telegram user session is required")
        await client.get_dialogs()
        channel = await client.get_entity(CHANNEL)
        messages = []
        async for message in client.iter_messages(channel, limit=None, reverse=True):
            file = message.file
            image = bool(message.photo or (message.document and file and (file.mime_type or "").startswith("image/")))
            entry = {"id": message.id, "date": utc_iso(message.date),
                     "text": message.message or "", "reply_to_message_id": message.reply_to_msg_id,
                     "grouped_id": str(message.grouped_id) if message.grouped_id else None,
                     "images": [], "mentioned_user_ids": []}
            # Only explicit text mentions, never sender/forward author IDs.
            for entity in message.entities or []:
                if isinstance(entity, types.MessageEntityMentionName):
                    entry["mentioned_user_ids"].append(str(entity.user_id))
            if image:
                downloaded = await client.download_media(message, file=str(run_dir / str(message.id)))
                entry["images"].append({"path": downloaded, "mime_type": file.mime_type,
                                        "size": file.size, "width": file.width, "height": file.height})
                if args.ocr and downloaded:
                    result = subprocess.run([args.ocr, downloaded, "stdout", "-l", args.ocr_language],
                                            capture_output=True, text=True, encoding="utf-8", check=True)
                    entry["ocr_text"] = result.stdout
            messages.append(entry)
        output = run_dir / "archive.json"
        output.write_text(json.dumps({"source_channel": CHANNEL, "channel_id": str(channel.id),
                                      "messages": messages}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"Exported {len(messages)} messages to {output}")
    finally:
        await client.disconnect()


if __name__ == "__main__":
    asyncio.run(main())
