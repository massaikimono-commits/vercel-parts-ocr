import fs from "node:fs";

const home = fs.readFileSync("app/home-dashboard.tsx", "utf8");
const login = fs.readFileSync("app/page.tsx", "utf8");
const entry = fs.readFileSync("app/vehicle-workflow/page.tsx", "utf8");
const v2 = fs.readFileSync("app/vehicle-workflow-v2/page.tsx", "utf8");
const fast = fs.readFileSync("app/vehicle-workflow-fast/page.tsx", "utf8");
const desktopNav = fs.readFileSync("app/desktop-quick-nav.tsx", "utf8");
const mobileNav = fs.readFileSync("app/mobile-quick-nav.tsx", "utf8");

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

assert(
  /className="desktopHero"[\s\S]*?location\.assign\("\/vehicle-workflow\?mode=new"\)/.test(home),
  "desktop vehicle registration must preserve mode=new",
);
assert(
  /className="vehicleRegisterAction"[\s\S]*?location\.assign\("\/vehicle-workflow\?mode=new"\)/.test(home),
  "mobile vehicle registration must preserve mode=new",
);
assert(
  /<form\s+onSubmit=\{\(event\)\s*=>\s*\{\s*event\.preventDefault\(\);\s*void loginWithProtection\(\);\s*\}\}>/.test(login),
  "login form must submit through the protected login flow",
);
assert(/<button\s+type="submit"[\s\S]*?>/.test(login), "login button must be a submit button");
assert(!/type="submit"[\s\S]{0,160}onClick=/.test(login), "login submit must not fork into a click-only path");

assert(
  /redirect\(mode\s*===\s*["']new["']\s*\?\s*["']\/vehicle-workflow-v2\?mode=new["']\s*:\s*["']\/vehicle-workflow-v2["']\)/.test(entry),
  "vehicle workflow redirect must preserve mode=new",
);
assert(
  /searchParams\.get\(["']mode["']\)\s*===\s*["']new["']/.test(v2),
  "vehicle workflow v2 must derive new-registration mode from the query",
);
assert(/複数台を一括登録/.test(v2) && /\/customer-vehicles\/bulk-import/.test(v2), "new-registration mode must expose bulk import");
assert(/newRegistrationMode\s*\?\s*<section[^>]*><h1>新規車両登録<\/h1>/.test(fast), "new mode must render the new-registration screen");
assert(/if\s*\(newRegistrationMode\)\s*\{\s*setVehicles\(\[\]\)/.test(fast), "new mode must suppress the existing vehicle list");

for (const href of ["/", "/schedule/new", "/schedule/search", "/customer-vehicles"]) {
  assert(desktopNav.includes(`href: "${href}"`), `desktop navigation missing ${href}`);
  assert(new RegExp(`href:\\s*["']${href.replaceAll("/", "\\/")}["']`).test(mobileNav), `mobile navigation missing ${href}`);
}
assert(/const todayHref\s*=\s*`\/schedule\?day=\$\{todayJst\(\)\}`/.test(desktopNav), "desktop Today navigation must retain the day query");
assert(/const todayHref\s*=\s*`\/schedule\?day=\$\{todayJst\(\)\}`/.test(mobileNav), "mobile Today navigation must retain the day query");

console.log("production PC routing regression: PASS");
