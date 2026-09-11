import unittest

from core import find_table_html, header_mapping, normalize, rows_from_html, rows_from_structure


class CoreTest(unittest.TestCase):
    def test_header_mapping(self):
        self.assertEqual(header_mapping(["部品名称", "個数", "定価", "仕入れ"]), {"name": 0, "qty": 1, "retail": 2, "cost": 3})

    def test_html_mapping_and_normalization(self):
        html = "<table><tr><th>品名</th><th>数量</th><th>標準価格</th><th>原価</th></tr><tr><td>ファン ベルト</td><td>１</td><td>2,250</td><td>1,025</td></tr></table>"
        rows = rows_from_html(html)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["fields"]["name"]["normalized"], "ファン ベルト")
        self.assertEqual(rows[0]["fields"]["retail"]["normalized"], "2250")
        self.assertEqual(rows[0]["fields"]["cost"]["normalized"], "1025")

    def test_no_header_abstains(self):
        self.assertEqual(rows_from_html("<table><tr><td>value</td></tr></table>"), [])

    def test_duplicate_detection(self):
        html = "<table><tr><th>名称</th><th>個数</th></tr><tr><td>A</td><td>1</td></tr><tr><td>A</td><td>1</td></tr></table>"
        rows = rows_from_structure({"table_res_list": [{"pred_html": html}]})
        self.assertEqual(rows[1]["duplicateOf"], "R01")

    def test_recursive_html_discovery(self):
        self.assertEqual(len(find_table_html({"nested": [{"pred_html": "<table></table>"}]})), 1)
        self.assertEqual(normalize("￥ 1,540", "cost"), "1540")


if __name__ == "__main__":
    unittest.main()
