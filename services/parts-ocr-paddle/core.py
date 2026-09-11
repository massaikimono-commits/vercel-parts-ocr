"""Dependency-free mapping for the P2 PP-StructureV3 PoC."""

from __future__ import annotations

import re
from html.parser import HTMLParser
from typing import Any

FIELDS = ("name", "qty", "retail", "cost")
HEADER_ALIASES = {
    "name": ("品名", "部品名称", "商品名", "名称", "description"),
    "qty": ("出庫数", "数量", "個数", "qty", "quantity"),
    "retail": ("標準価格", "定価", "単価", "retail", "listprice"),
    "cost": ("仕入", "原価", "卸値", "cost", "purchase"),
}


class TableParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.rows: list[list[str]] = []
        self._row: list[str] | None = None
        self._cell: list[str] | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "tr":
            self._row = []
        elif tag in ("td", "th") and self._row is not None:
            self._cell = []

    def handle_data(self, data: str) -> None:
        if self._cell is not None:
            self._cell.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag in ("td", "th") and self._row is not None and self._cell is not None:
            self._row.append(" ".join(self._cell).strip())
            self._cell = None
        elif tag == "tr" and self._row is not None:
            if any(self._row):
                self.rows.append(self._row)
            self._row = None


def normalize(raw: str, field: str) -> str:
    text = " ".join(str(raw).replace("\r", "").split()).strip()
    if field == "name":
        return text.strip(" |:;.,・")
    text = text.translate(str.maketrans({"I": "1", "l": "1", "!": "1", "O": "0", "o": "0"}))
    candidates = re.findall(r"\d{1,3}(?:[,\.\s]\d{3})+|\d{1,7}", text)
    return re.sub(r"\D", "", candidates[0]) if candidates else ""


def header_mapping(header: list[str]) -> dict[str, int]:
    compact = [re.sub(r"[\s/／・:_-]", "", value).lower() for value in header]
    mapping: dict[str, int] = {}
    for field, aliases in HEADER_ALIASES.items():
        for index, value in enumerate(compact):
            if any(re.sub(r"[\s/／・:_-]", "", alias).lower() in value for alias in aliases):
                mapping[field] = index
                break
    return mapping


def rows_from_html(html: str, source: str = "p2-ppstructure-table") -> list[dict[str, Any]]:
    parser = TableParser()
    parser.feed(html or "")
    if not parser.rows:
        return []
    header_index = -1
    mapping: dict[str, int] = {}
    for index, row in enumerate(parser.rows[:8]):
        candidate = header_mapping(row)
        if len(candidate) > len(mapping):
            header_index, mapping = index, candidate
    if "name" not in mapping or len(mapping) < 2:
        return []
    output = []
    for index, cells in enumerate(parser.rows[header_index + 1 :], start=1):
        fields: dict[str, dict[str, Any]] = {}
        for field in FIELDS:
            column = mapping.get(field)
            raw = cells[column] if column is not None and column < len(cells) else ""
            fields[field] = {"raw": raw, "normalized": normalize(raw, field), "confidence": None, "source": source}
        if not any(value["normalized"] for value in fields.values()):
            continue
        output.append({"rowId": f"R{index:02d}", "region": None, "fields": fields, "confidence": None, "duplicateOf": None})
    return output


def find_table_html(payload: Any) -> list[str]:
    found: list[str] = []
    if isinstance(payload, dict):
        for key, value in payload.items():
            if key in ("pred_html", "html") and isinstance(value, str) and "<table" in value.lower():
                found.append(value)
            else:
                found.extend(find_table_html(value))
    elif isinstance(payload, list):
        for value in payload:
            found.extend(find_table_html(value))
    return found


def rows_from_structure(payload: Any) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for html in find_table_html(payload):
        rows.extend(rows_from_html(html))
    seen: dict[str, str] = {}
    for row in rows:
        signature = "|".join(row["fields"][field]["normalized"] for field in FIELDS)
        if signature.strip("|") and signature in seen:
            row["duplicateOf"] = seen[signature]
        elif signature.strip("|"):
            seen[signature] = row["rowId"]
    return rows
