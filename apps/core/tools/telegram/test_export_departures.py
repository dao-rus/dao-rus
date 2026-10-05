import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import export_departures as exporter


class ExportTests(unittest.IsolatedAsyncioTestCase):
    async def test_full_history_images_and_context(self):
        class Client:
            async def connect(self): pass
            async def disconnect(self): pass
            async def is_user_authorized(self): return True
            async def get_me(self): return SimpleNamespace(bot=False)
            async def get_dialogs(self): pass
            async def get_entity(self, channel):
                self.channel = channel
                return SimpleNamespace(id=999)
            async def download_media(self, message, file): return file + ".jpg"
            async def iter_messages(self, channel, **kwargs):
                self.options = kwargs
                yield SimpleNamespace(id=42, date=datetime(2020, 1, 2, tzinfo=timezone.utc),
                    file=SimpleNamespace(mime_type="image/jpeg", size=100, width=20, height=30),
                    photo=True, document=None, message="caption @example", reply_to_msg_id=41,
                    grouped_id=12, entities=[])
        client = Client()
        with tempfile.TemporaryDirectory() as folder, \
                patch.object(exporter, "LOCAL_DIR", Path(folder)), \
                patch.object(exporter, "TelegramClient", return_value=client), \
                patch.object(exporter, "required_api_id", return_value=1), \
                patch.object(exporter, "required_api_hash", return_value="test"), \
                patch("sys.argv", ["export_departures.py"]):
            await exporter.main()
            archive = json.loads(next(Path(folder).glob("*/archive.json")).read_text(encoding="utf-8"))
            self.assertEqual(client.options, {"limit": None, "reverse": True})
            self.assertEqual(client.channel, "@list_of_exites")
            self.assertEqual(archive["messages"][0]["date"], "2020-01-02T00:00:00Z")
            self.assertEqual(archive["messages"][0]["text"], "caption @example")
            self.assertEqual(archive["messages"][0]["images"][0]["width"], 20)
            self.assertTrue(Path(archive["messages"][0]["images"][0]["path"]).is_relative_to(folder))

    async def test_requires_already_authorized_session(self):
        class Client:
            async def connect(self): pass
            async def disconnect(self): self.disconnected = True
            async def is_user_authorized(self): return False
        client = Client()
        with tempfile.TemporaryDirectory() as folder, \
                patch.object(exporter, "LOCAL_DIR", Path(folder)), \
                patch.object(exporter, "TelegramClient", return_value=client), \
                patch.object(exporter, "required_api_id", return_value=1), \
                patch.object(exporter, "required_api_hash", return_value="test"), \
                patch("sys.argv", ["export_departures.py"]):
            with self.assertRaisesRegex(RuntimeError, "already authorized"):
                await exporter.main()
            self.assertTrue(client.disconnected)


if __name__ == "__main__":
    unittest.main()
