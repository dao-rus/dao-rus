"""Export only Core-linked cached profile aliases from a read-only Telethon session."""
import argparse
import json
import sqlite3
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path


def cached_aliases(session: Path, participants):
    ids = {str(value) for p in participants for value in [p.get("telegram_user_id"), *p.get("telegram_user_ids", [])]
           if value and str(value).isdigit() and int(value) > 0}
    if not ids:
        return []
    with closing(sqlite3.connect(session.resolve().as_uri() + "?mode=ro", uri=True)) as connection:
        rows = connection.execute("SELECT id, username, name, date FROM entities WHERE id IN (" + ",".join("?" for _ in ids) + ")", list(ids)).fetchall()
    return [{"telegram_user_id": str(row[0]), "username": row[1], "display_name": row[2],
             "observed_at": datetime.fromtimestamp(row[3], timezone.utc).isoformat().replace("+00:00", "Z") if row[3] else None}
            for row in rows]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--session", type=Path, required=True)
    parser.add_argument("--participants", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    entries = cached_aliases(args.session, json.loads(args.participants.read_text(encoding="utf-8")))
    with args.output.open("x", encoding="utf-8") as stream:
        json.dump({"source": "telethon_entities_cache", "entries": entries}, stream, ensure_ascii=False, indent=2)
        stream.write("\n")
    print(f"Exported {len(entries)} Core-linked cached profiles")


if __name__ == "__main__":
    main()
