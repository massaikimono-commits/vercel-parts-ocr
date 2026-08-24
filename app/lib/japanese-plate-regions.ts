// Japanese registration plate region names used only to validate/correct the region
// text actually read from the registration-number cell. Address/customer data is never
// consulted. The list covers standard transport-office names and current local-number
// names, including recent additions.
export const JAPANESE_PLATE_REGIONS = [
  "札幌","函館","旭川","室蘭","釧路","帯広","北見","知床","苫小牧","十勝",
  "青森","弘前","八戸","岩手","盛岡","平泉","宮城","仙台","秋田","山形","庄内","福島","会津","郡山","いわき","白河",
  "水戸","土浦","つくば","宇都宮","那須","日光","とちぎ","群馬","高崎","前橋",
  "大宮","川口","所沢","川越","熊谷","春日部","越谷",
  "千葉","成田","習志野","袖ヶ浦","野田","柏","松戸","市川","船橋","市原",
  "品川","世田谷","杉並","江東","葛飾","板橋","江戸川","練馬","足立","多摩","八王子",
  "横浜","川崎","湘南","相模","山梨","富士山",
  "新潟","長岡","上越","長野","松本","諏訪","安曇野","南信州","富山","金沢","石川",
  "福井","岐阜","飛騨","静岡","浜松","沼津","伊豆","名古屋","尾張小牧","一宮","春日井","三河","豊橋","岡崎","豊田","三重","鈴鹿","四日市","伊勢志摩",
  "滋賀","京都","大阪","なにわ","和泉","堺","神戸","姫路","奈良","飛鳥","和歌山",
  "鳥取","島根","出雲","岡山","倉敷","広島","福山","山口","下関",
  "徳島","香川","高松","愛媛","高知",
  "福岡","北九州","久留米","筑豊","佐賀","長崎","佐世保","熊本","大分","宮崎","鹿児島","奄美","沖縄",
] as const;

function normalize(value = "") {
  return String(value)
    .normalize("NFKC")
    .replace(/[\s\u3000・･.。()（）\[\]【】]/g, "");
}

function editDistance(a = "", b = "") {
  const x = [...a];
  const y = [...b];
  const row = Array.from({ length: y.length + 1 }, (_, index) => index);
  for (let i = 1; i <= x.length; i += 1) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= y.length; j += 1) {
      const old = row[j];
      row[j] = Math.min(
        row[j] + 1,
        row[j - 1] + 1,
        previous + (x[i - 1] === y[j - 1] ? 0 : 1),
      );
      previous = old;
    }
  }
  return row[y.length];
}

/**
 * Returns a plate region only when the OCR string itself is a confident match.
 * It never maps an address/city to a registration office. For example, 松原市 does
 * not imply 和泉; only OCR text from the registration-number cell can produce 和泉.
 */
export function normalizeJapanesePlateRegion(value = "") {
  const raw = normalize(value);
  if (!raw) return "";
  const exact = JAPANESE_PLATE_REGIONS.find(region => normalize(region) === raw);
  if (exact) return exact;

  const ranked = JAPANESE_PLATE_REGIONS
    .map(region => ({ region, distance: editDistance(raw, normalize(region)) }))
    .sort((a, b) => a.distance - b.distance || a.region.length - b.region.length);

  const best = ranked[0];
  const second = ranked[1];
  if (!best) return "";
  const maxLength = Math.max([...raw].length, [...best.region].length, 1);
  const similarity = 1 - best.distance / maxLength;
  const allowedDistance = maxLength <= 3 ? 1 : 2;
  const unique = !second || second.distance > best.distance;

  if (unique && best.distance <= allowedDistance && similarity >= 0.62) return best.region;
  return "";
}
