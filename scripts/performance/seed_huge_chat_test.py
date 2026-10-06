import contextlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


spec = importlib.util.spec_from_file_location("seed_huge_chat", Path(__file__).with_name("seed-huge-chat.py"))
seed = importlib.util.module_from_spec(spec)
spec.loader.exec_module(seed)


class HugeChatFormatTest(unittest.TestCase):
    def run_seed(self, directory):
        output = io.StringIO()
        args = ["seed-huge-chat.py", "--data-dir", str(directory), "--template-chat", "aaaa", "--turns", "2", "--text-kb", "1", "--tool-kb", "1", "--telemetry-kb", "1"]
        with patch("sys.argv", args), patch.object(seed.secrets, "token_hex", return_value="bbbb"), patch.object(seed.time, "time", return_value=1234), contextlib.redirect_stdout(output):
            seed.main()
        return json.loads(output.getvalue())

    def test_fixture_format_and_source_preservation(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            original = root / "chats/aaaa/meta.json"
            original.parent.mkdir(parents=True)
            source = '{"id":"aaaa","projectId":"project-1","accountId":"account-1","provider":"codex","sessions":{"codex":"private-session"},"running":true}'
            original.write_text(source)
            result = self.run_seed(root)
            meta = json.loads((root / "chats/bbbb/meta.json").read_text())
            self.assertEqual(meta, {"projectId":"project-1","accountId":"account-1","provider":"codex","id":"bbbb","title":"PERF TEST — 2 turns","createdAt":1233998,"lastMessageAt":1234000,"lastReadAt":1234000,"running":False})
            events = [json.loads(line) for line in (root / "chats/bbbb/events.jsonl").read_text().splitlines()]
            self.assertEqual([e["seq"] for e in events], list(range(1, 13)))
            self.assertEqual([e["type"] for e in events], ["user","provider_event","tool_use_start","tool_use_end","assistant_text","complete"] * 2)
            for turn in (1, 2):
                group = events[(turn-1)*6:turn*6]
                self.assertTrue(all(e["t"] == 1233998+turn and e["turnId"] == f"fixture-{turn}" for e in group))
                line = f"Synthetic turn {turn}: search needle-{turn} / rendering and history test.\n"
                payload = (line * (1024 // len(line) + 1))[:1024]
                self.assertEqual(group[1]["data"], {"fixture": payload})
                self.assertEqual(group[3]["output"], payload)
                self.assertEqual(group[4]["text"], payload)
                self.assertEqual(group[2]["input"], {"command":"echo synthetic-fixture"})
            self.assertEqual(original.read_text(), source)
            self.assertEqual(result["events"], 12)
            self.assertEqual(result["route"], "/chats/bbbb")
            self.assertFalse((root / "chats/.seed-bbbb").exists())
            with self.assertRaises(FileExistsError):
                self.run_seed(root)
            self.assertEqual(json.loads((root / "chats/bbbb/meta.json").read_text()), meta)


if __name__ == "__main__":
    unittest.main()
