import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path
from export_departure_session_aliases import cached_aliases


class SessionAliasTests(unittest.TestCase):
    def test_exports_only_stably_linked_core_profiles_and_keeps_session_unchanged(self):
        with tempfile.TemporaryDirectory() as directory:
            session = Path(directory) / "user.session"
            with closing(sqlite3.connect(session)) as connection:
                connection.execute("CREATE TABLE entities(id INTEGER PRIMARY KEY, username TEXT, name TEXT, date INTEGER)")
                connection.executemany("INSERT INTO entities VALUES (?,?,?,?)", [(123, "old_user", "Старое Имя", 1577836800), (456, "unrelated", "Other contact", 1577836800)])
                connection.commit()
            before = session.read_bytes()
            entries = cached_aliases(session, [{"telegram_user_id": "123", "telegram_user_ids": []}])
            self.assertEqual(entries, [{"telegram_user_id": "123", "username": "old_user", "display_name": "Старое Имя", "observed_at": "2020-01-01T00:00:00Z"}])
            self.assertEqual(session.read_bytes(), before)


if __name__ == "__main__":
    unittest.main()
