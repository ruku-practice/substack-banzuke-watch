"""scrape.parse_page の検査（ネットワーク不要）。

  python3 -m unittest discover -s tests

2026-09-13: 元サイトの改修で旧パーサが黙って0件になった。新旧どちらの形式も読めること、
読めないときは「未公開」ではなく「構造変化」として止まることを固定する。
"""

import os
import sys
import unittest
from datetime import date

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
import scrape  # noqa: E402

D = date(2026, 9, 6)


def page(items_html, label="2026年9月6日の番付"):
    return (f'<html><body><section class="ssr-archive" aria-label="{label}"><h2>{label}</h2>'
            f"<ol>{items_html}</ol></section></body></html>")


NEW_LI = """<li>
  <a href="https://a.substack.com/p/1">題A</a>
  <span>発行元A</span>
  <small>注目度 89 / ♥ 32 / Restack 12 / コメント 8</small>
</li><li>
  <a href="https://rukupractice.substack.com/p/2">題B</a>
  <span>ルク</span>
  <small>注目度 70 / ♥ 0 / Restack 0 / コメント 0</small>
</li>"""

OLD_LI = """<li><b>1位</b> <span class="topic-label">日記</span>
  <a href="https://a.substack.com/p/1">題A</a> <span>発行元: 発行元A</span>
  <small>注目度 89 / ♥ 32 / Restack 12 / コメント 8</small></li>
<li><b>2位</b> <a href="https://b.substack.com/p/2">題B</a> <span>発行元: B</span>
  <small>注目度 70 / ♥ 1 / Restack 2 / コメント 3</small></li>"""


class ParsePageTest(unittest.TestCase):
    def test_new_format_uses_list_order_as_rank(self):
        rows, status, _ = scrape.parse_page(page(NEW_LI), D)
        self.assertEqual(status, scrape.OK)
        self.assertEqual([r["rank"] for r in rows], [1, 2])
        self.assertEqual(rows[0]["publisher"], "発行元A")
        self.assertEqual((rows[0]["attention_score"], rows[0]["likes"], rows[0]["restacks"], rows[0]["comments"]), (89, 32, 12, 8))
        self.assertEqual(rows[0]["category"], "")
        self.assertEqual(rows[1]["is_ruku"], "1")
        self.assertEqual(rows[1]["likes"], 0)

    def test_old_format_still_parses(self):
        rows, status, _ = scrape.parse_page(page(OLD_LI), D)
        self.assertEqual(status, scrape.OK)
        self.assertEqual([r["rank"] for r in rows], [1, 2])
        self.assertEqual(rows[0]["category"], "日記")
        self.assertEqual(rows[0]["publisher"], "発行元A")
        self.assertEqual(rows[1]["publisher"], "B")

    def test_page_without_archive_is_not_published(self):
        _, status, _ = scrape.parse_page("<html><h1>日本語Substack人気ランキング</h1></html>", D)
        self.assertEqual(status, scrape.NOT_PUBLISHED)

    def test_rows_that_cannot_be_parsed_are_structure_change(self):
        broken = "<li><div class='title'>題A</div><em>発行元A</em><p>89pt</p></li>"
        _, status, _ = scrape.parse_page(page(broken), D)
        self.assertEqual(status, scrape.STRUCTURE_CHANGED)

    def test_missing_score_is_structure_change_not_zero(self):
        li = '<li><a href="https://a.substack.com/p/1">題A</a><span>A</span><small>注目度 89 / ♥ 32</small></li>'
        _, status, _ = scrape.parse_page(page(li), D)
        self.assertEqual(status, scrape.STRUCTURE_CHANGED)

    def test_page_for_another_date_is_rejected(self):
        _, status, _ = scrape.parse_page(page(NEW_LI, label="2026年9月5日の番付"), D)
        self.assertEqual(status, scrape.STRUCTURE_CHANGED)


if __name__ == "__main__":
    unittest.main()
