import fs from "node:fs";

const css = fs.readFileSync("app/desktop-compact.css", "utf8");
const layout = fs.readFileSync("app/layout.tsx", "utf8");
const required = [
  "@media (min-width: 981px)",
  ".homeDash",
  ".desktopHero",
  ".dateSearch",
  ".desktopTools",
  "input, select, textarea",
  ".card",
  "th, td",
  "form button",
];
for (const token of required) {
  if (!css.includes(token)) throw new Error(`desktop compact token missing: ${token}`);
}
if (!layout.includes('import "./desktop-compact.css";')) throw new Error("desktop compact stylesheet is not source-mounted");
if (css.includes("transform: scale")) throw new Error("whole-screen scale is prohibited");
if (!css.includes("@media print")) throw new Error("print isolation guard missing");
if (css.includes("max-width: 760px") || css.includes("max-width:760px")) throw new Error("desktop layer must not override approved mobile breakpoint");
console.log("Desktop compact responsive regression PASS");
