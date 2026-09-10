import fs from "node:fs";

const pagePath = "app/customer-vehicles/page.tsx";
let page = fs.readFileSync(pagePath, "utf8");

function replaceOnce(source, before, after, label) {
  if (!source.includes(before)) throw new Error(`${label} anchor not found`);
  return source.replace(before, after);
}

page = replaceOnce(page,
`  function openParts() {
    if (!selectedVehicle) return;
    selectVehicle(selectedVehicle);
    location.assign("/parts-data");
  }
`,
`  function openParts() {
    if (!selectedVehicle) return;
    selectVehicle(selectedVehicle);
    location.assign("/parts-data");
  }

  function callSelectedCustomer() {
    const phone = selectedCustomer?.phone.trim();
    if (!phone) return;
    location.href = \`tel:\${phone.replace(/\\s+/g, "")}\`;
  }

  function openSelectedAddress() {
    const address = selectedCustomer?.address.trim();
    if (!address) return;
    window.open(
      \`https://www.google.com/maps/search/?api=1&query=\${encodeURIComponent(address)}\`,
      "_blank",
      "noopener,noreferrer"
    );
  }
`, "openParts");

page = replaceOnce(page,
`        <input
          className="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          inputMode={vehicleSearchMode === "last4" ? "numeric" : vehicleSearchMode === "phone" ? "tel" : "text"}
          maxLength={vehicleSearchMode === "last4" ? 4 : undefined}
          placeholder={vehicleSearchMode === "last4" ? "例：10 / 1234" : vehicleSearchMode === "customer" ? "例：山田 / 株式会社ICB" : "例：090-1234-5678"}
        />
`,
`        <div className="searchRow">
          <input
            className="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            inputMode={vehicleSearchMode === "last4" ? "numeric" : vehicleSearchMode === "phone" ? "tel" : "text"}
            maxLength={vehicleSearchMode === "last4" ? 4 : undefined}
            placeholder={vehicleSearchMode === "last4" ? "例：10 / 1234" : vehicleSearchMode === "customer" ? "例：山田 / 株式会社ICB" : "例：090-1234-5678"}
          />
          {query && <button type="button" className="clearSearch" aria-label="検索をクリア" onClick={() => setQuery("")}>×</button>}
        </div>
`, "search input");

page = replaceOnce(page,
`              <button onClick={() => location.assign("/schedule/active")}>📅 次回予定登録</button>
              <button onClick={() => location.assign("/schedule")}>📅 入出庫予定</button>
              <button onClick={() => location.assign("/vehicle-workflow")}>車両情報を編集</button>
`,
`              <button onClick={() => location.assign("/schedule/active")}>📅 次回予定登録</button>
              {selectedCustomer?.phone && <button onClick={callSelectedCustomer}>📞 電話する</button>}
              {selectedCustomer?.address && <button onClick={openSelectedAddress}>🗺 地図を開く</button>}
              <button onClick={() => location.assign("/schedule")}>📅 入出庫予定</button>
              <button onClick={() => location.assign("/vehicle-workflow")}>車両情報を編集</button>
`, "selected vehicle actions");

page = replaceOnce(page,
`.search,.customerForm input,.customerForm textarea,.linkBox input,.linkBox select{width:100%;border:1px solid #cdd7e5;border-radius:12px;padding:14px;font-size:16px;background:#fff;color:#172033}`,
`.search,.customerForm input,.customerForm textarea,.linkBox input,.linkBox select{width:100%;border:1px solid #cdd7e5;border-radius:12px;padding:14px;font-size:16px;background:#fff;color:#172033}.searchRow{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:7px;align-items:center}.clearSearch{min-width:46px;padding:12px 14px;font-size:20px;line-height:1}`,
"search css");
fs.writeFileSync(pagePath, page);

const regressionPath = "scripts/ux-context-preservation-regression.mjs";
let regression = fs.readFileSync(regressionPath, "utf8");
const marker = "assert.ok(detail.includes('>1日の予定</button>'));\n";
const extra = [
  "assert.ok(customer.includes('aria-label=\\\"検索をクリア\\\"'), \\\"customer vehicle search has one-tap clear\\\");",
  "assert.ok(customer.includes('function callSelectedCustomer()'), \\\"selected customer has direct call action\\\");",
  "assert.ok(customer.includes('location.href = `tel:'), \\\"call action uses tel link\\\");",
  "assert.ok(customer.includes('function openSelectedAddress()'), \\\"selected customer has direct map action\\\");",
  "assert.ok(customer.includes('https://www.google.com/maps/search/?api=1&query='), \\\"map action uses encoded map search\\\");"
].join("\n") + "\n";
regression = replaceOnce(regression, marker, marker + extra, "regression");
fs.writeFileSync(regressionPath, regression);
