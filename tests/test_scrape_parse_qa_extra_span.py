"""断（QA）が追加した検査：<li> 内の余計な <span> で発行元が黙って誤データになる穴の証明。

2026-09-13 断の1回目検収で発見。修正はしない（担当へ返す）。このテストは現状のscrape.pyに対して
FAIL することを確認済み（=穴が実在する証拠）。担当が直したら green になるはず。

  python3 -m unittest tests.test_scrape_parse_qa_extra_span -v
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


class ExtraSpanSilentBadDataTest(unittest.TestCase):
    def test_decorative_span_before_publisher_does_not_silently_replace_publisher(self):
        """<a>題</a> の直後に「新」「PR」等の飾りspanが1個挟まると、
        BanzukeParserは collect_mode が None であることだけを条件に次のspanを
        publisherとして拾ってしまう（scripts/scrape.py handle_starttag の
        `elif self._collect_mode is None and "publisher" not in self._current`）。

        結果：本当の発行元名が失われて飾りspanの文字列（この例では空文字列）が
        publisherとして書き込まれ、status は OK のまま＝黙って誤データが混入する。
        """
        li = (
            '<li><a href="https://a.substack.com/p/1">題A</a>'
            '<span class="badge">新</span>'
            '<span>本当の発行元名</span>'
            '<small>注目度 89 / ♥ 32 / Restack 12 / コメント 8</small></li>'
        )
        rows, status, detail = scrape.parse_page(page(li), D)
        self.assertEqual(status, scrape.OK, f"想定：構造変化ではなく普通に解析が通ってしまう（detail={detail}）")
        self.assertEqual(
            rows[0]["publisher"], "本当の発行元名",
            "実際の値: %r ＝ 飾りspanの文字列(または空文字)がpublisherに書き込まれている（黙って誤データ）" % rows[0]["publisher"],
        )


if __name__ == "__main__":
    unittest.main()
