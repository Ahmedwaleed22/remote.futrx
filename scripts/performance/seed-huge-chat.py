#!/usr/bin/env python3
"""Create a new offline Remote chat fixture; never overwrite an existing chat."""
import argparse
import json
import os
from pathlib import Path
import secrets
import shutil
import time


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", type=Path, required=True, help="Remote backend DATA_DIR; restart backend after generation")
    parser.add_argument("--template-chat", help="Existing chat ID whose project/account settings should be copied")
    parser.add_argument("--turns", type=int, default=2000)
    parser.add_argument("--text-kb", type=int, default=8, help="Assistant text per turn")
    parser.add_argument("--tool-kb", type=int, default=32, help="Tool output per turn")
    parser.add_argument("--telemetry-kb", type=int, default=16, help="Raw provider telemetry per turn")
    args = parser.parse_args()
    if not 1 <= args.turns <= 100000 or any(not 0 <= n <= 1024 for n in (args.text_kb, args.tool_kb, args.telemetry_kb)):
        parser.error("turns must be 1..100000; payload sizes must be 0..1024 KB")
    root = args.data_dir.resolve() / "chats"
    meta = {}
    if args.template_chat:
        if not all(c in "0123456789abcdef" for c in args.template_chat) or not args.template_chat:
            parser.error("template chat ID must be hexadecimal")
        source = json.loads((root / args.template_chat / "meta.json").read_text())
        for key in ("projectId", "accountId", "provider", "cwd", "model", "mode", "reasoningEffort", "serviceTier", "approvalPolicy", "sandboxPolicy"):
            if key in source:
                meta[key] = source[key]
    chat_id = secrets.token_hex(6)
    root.mkdir(parents=True, exist_ok=True)
    staging = root / (".seed-" + chat_id)
    staging.mkdir()
    now = int(time.time() * 1000)
    meta.update(id=chat_id, title=f"PERF TEST — {args.turns:,} turns", createdAt=now-args.turns, lastMessageAt=now, lastReadAt=now, running=False)
    seq = 0
    try:
        with (staging / "events.jsonl").open("w") as log:
            def emit(kind, turn, **fields):
                nonlocal seq
                seq += 1
                log.write(json.dumps(dict(seq=seq, t=now-args.turns+turn, type=kind, turnId=f"fixture-{turn}", **fields), ensure_ascii=False) + "\n")

            def payload(kb, turn):
                line = f"Synthetic turn {turn}: search needle-{turn} / rendering and history test.\n"
                return (line * ((kb * 1024 // len(line)) + 1))[:kb * 1024]

            for turn in range(1, args.turns + 1):
                emit("user", turn, text=f"Test question {turn}: summarize the fixture output.")
                if args.telemetry_kb:
                    emit("provider_event", turn, data={"fixture": payload(args.telemetry_kb, turn)})
                if args.tool_kb:
                    emit("tool_use_start", turn, id=f"tool-{turn}", name="Bash", input={"command": "echo synthetic-fixture"})
                    emit("tool_use_end", turn, id=f"tool-{turn}", output=payload(args.tool_kb, turn))
                emit("assistant_text", turn, messageId=f"answer-{turn}", text=payload(args.text_kb, turn))
                emit("complete", turn)
        (staging / "meta.json").write_text(json.dumps(meta, ensure_ascii=False))
        destination = root / chat_id
        # Exclusive directory creation ensures even an ID collision cannot overwrite.
        destination.mkdir()
        try:
            for name in ("events.jsonl", "meta.json"):
                os.replace(staging / name, destination / name)
        except BaseException:
            shutil.rmtree(destination)
            raise
        print(json.dumps({"chat_id": chat_id, "turns": args.turns, "events": seq, "log_mb": round((destination / "events.jsonl").stat().st_size / 1_000_000, 2), "directory": str(destination), "route": f"/chats/{chat_id}", "next": "Restart the backend, then open the route on your Remote URL."}, indent=2))
    finally:
        shutil.rmtree(staging)


if __name__ == "__main__":
    main()
