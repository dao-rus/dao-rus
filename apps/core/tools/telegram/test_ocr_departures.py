import unittest
from types import SimpleNamespace
from unittest.mock import patch

from ocr_departures import recognize


class OcrTests(unittest.TestCase):
    def test_literal_quote_does_not_swallow_the_following_tsv_row(self):
        tsv = "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n5\t1\t1\t1\t1\t1\t1\t2\t3\t4\t50\t\"\n5\t1\t2\t1\t1\t1\t1\t2\t3\t4\t95\t@ivan_test\n"
        with patch("ocr_departures.subprocess.run", return_value=SimpleNamespace(stdout=tsv)):
            text, words = recognize("tesseract.exe", "local.jpg", "rus+eng")
        self.assertEqual(text, '"\n@ivan_test')
        self.assertEqual(len(words), 2)

    def test_preserves_tesseract_text_confidence_and_line_grouping(self):
        header = "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n"
        tsv = header + "5\t1\t1\t1\t1\t1\t10\t20\t30\t40\t95.5\tИван\n" + "5\t1\t1\t1\t1\t2\t50\t20\t30\t40\t90\tПетров\n" + "5\t1\t2\t1\t1\t1\t10\t70\t100\t40\t80\t@ivan_test\n"
        with patch("ocr_departures.subprocess.run", return_value=SimpleNamespace(stdout=tsv)) as run:
            text, words = recognize("tesseract.exe", "local.jpg", "rus+eng")
        self.assertEqual(text, "Иван Петров\n@ivan_test")
        self.assertEqual(words[0]["confidence"], 95.5)
        self.assertEqual(words[2]["top"], 70)
        self.assertIn("rus+eng", run.call_args.args[0])


if __name__ == "__main__":
    unittest.main()
