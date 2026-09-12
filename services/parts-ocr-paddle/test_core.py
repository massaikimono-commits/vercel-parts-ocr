import unittest

from core import find_table_html, header_mapping, normalize, p2_safety_reasons, rows_from_html, rows_from_structure, structure_diagnostics


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

    def test_structure_diagnostics_are_count_only(self):
        html = "<table><tr><th>名称</th><th>個数</th></tr><tr><td>A</td><td>1</td></tr></table>"
        trace = structure_diagnostics({"table_res_list": [{"pred_html": html}], "rec_texts": ["secret-a", "secret-b"]})
        self.assertEqual(trace["tableHtmlCount"], 1)
        self.assertEqual(trace["htmlRowCount"], 2)
        self.assertEqual(trace["parsedRowCount"], 1)
        self.assertEqual(trace["textLikeValueCount"], 2)
        self.assertTrue(trace["headerCandidates"][0]["hasName"])
        self.assertNotIn("secret-a", str(trace))
        self.assertNotIn("secret-b", str(trace))

    def test_partial_header_rows_require_manual_review(self):
        html = "<table><tr><th>名称</th><th>個数</th></tr><tr><td>A</td><td>1</td></tr></table>"
        payload = {"table_res_list": [{"pred_html": html}]}
        rows = rows_from_structure(payload)
        self.assertEqual(len(rows), 1)
        self.assertIn("partial-header-mapping", p2_safety_reasons(payload, rows))

    def test_full_single_table_can_pass_safety_contract(self):
        html = "<table><tr><th>名称</th><th>個数</th><th>定価</th><th>仕入</th></tr><tr><td>A</td><td>1</td><td>100</td><td>80</td></tr></table>"
        payload = {"table_res_list": [{"pred_html": html}]}
        rows = rows_from_structure(payload)
        self.assertEqual(p2_safety_reasons(payload, rows), [])

    def test_multiple_tables_are_fail_closed(self):
        full = "<table><tr><th>名称</th><th>個数</th><th>定価</th><th>仕入</th></tr><tr><td>A</td><td>1</td><td>100</td><td>80</td></tr></table>"
        partial = "<table><tr><th>名称</th><th>個数</th></tr><tr><td>B</td><td>2</td></tr></table>"
        payload = {"table_res_list": [{"pred_html": full}, {"pred_html": partial}]}
        rows = rows_from_structure(payload)
        reasons = p2_safety_reasons(payload, rows)
        self.assertIn("ambiguous-table-structure", reasons)
        self.assertIn("partial-header-mapping", reasons)


if __name__ == "__main__":
    unittest.main()
