"""OCR downloaded archive images locally; never connect to Telegram or Core DB."""
import argparse
import csv
import hashlib
import io
import json
import subprocess
from pathlib import Path


def recognize(executable, image, language):
    result = subprocess.run([executable, str(image), "stdout", "-l", language, "--psm", "11", "tsv"],
                            capture_output=True, text=True, encoding="utf-8", check=True, timeout=120)
    lines, words = {}, []
    # TSV text may itself be a quote. It must never consume following TSV rows.
    for row in csv.DictReader(io.StringIO(result.stdout), delimiter="\t", quoting=csv.QUOTE_NONE):
        if row["level"] != "5" or not row["text"].strip():
            continue
        word = {"text": row["text"], "confidence": float(row["conf"]),
                "left": int(row["left"]), "top": int(row["top"]),
                "width": int(row["width"]), "height": int(row["height"])}
        words.append(word)
        key = tuple(row[field] for field in ("page_num", "block_num", "par_num", "line_num"))
        lines.setdefault(key, []).append(row["text"])
    return "\n".join(" ".join(line) for line in lines.values()), words


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path)
    parser.add_argument("--tesseract", required=True)
    parser.add_argument("--language", default="rus+eng")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    source = args.archive.read_bytes()
    archive = json.loads(source)
    if archive.get("source_channel") != "@list_of_exites":
        raise ValueError("Unexpected archive channel")
    output = args.output or args.archive.with_name("ocr-evidence.json")
    if output.exists():
        raise FileExistsError("OCR evidence output already exists")
    entries, count = [], 0
    for message in archive["messages"]:
        files = []
        for image in message.get("images", []):
            image_path = Path(image["path"]).resolve(strict=True)
            if not image_path.is_relative_to(args.archive.resolve().parent):
                raise ValueError("Image must stay in the local archive directory")
            text, words = recognize(args.tesseract, image_path, args.language)
            files.append({"path": str(image_path), "image_sha256": hashlib.sha256(image_path.read_bytes()).hexdigest(),
                          "text": text, "words": words})
            count += 1
            print(f"OCR {count}: message {message['id']}", flush=True)
        if files:
            entries.append({"source_message_id": message["id"], "ocr_text": "\n".join(f["text"] for f in files), "files": files})
    evidence = {"source_channel": archive["source_channel"], "archive_sha256": hashlib.sha256(source).hexdigest(),
                "engine": "tesseract", "language": args.language, "page_segmentation_mode": 11,
                "image_count": count, "entries": entries}
    with output.open("x", encoding="utf-8") as stream:
        json.dump(evidence, stream, ensure_ascii=False, indent=2)
        stream.write("\n")
    print(f"OCR evidence for {count} images: {output}")


if __name__ == "__main__":
    main()
