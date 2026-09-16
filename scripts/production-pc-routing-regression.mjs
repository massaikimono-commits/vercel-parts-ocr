import fs from "node:fs";

const home = fs.readFileSync("app/home-dashboard.tsx", "utf8");
const login = fs.readFileSync("app/page.tsx", "utf8");

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

console.log("production PC routing regression: PASS");
