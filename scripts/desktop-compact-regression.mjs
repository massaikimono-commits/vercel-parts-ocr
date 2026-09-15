import fs from "node:fs";

const css = fs.readFileSync("app/desktop-compact.css", "utf8");
const layout = fs.readFileSync("app/layout.tsx", "utf8");
const compactCss = css.replace(/\s+/g, "");
const required = [
  "@media(min-width:981px)",
  ".homeDash",
  ".desktopHero",
  ".dateSearch",
  ".desktopTools",
  "input,select,textarea",
  ".card",
  "th,td",
  "formbutton",
];
for (const token of required) {
  if (!compactCss.includes(token)) throw new Error(`desktop compact token missing: ${token}`);
}
if (!layout.includes('import "./desktop-compact.css";')) throw new Error("desktop compact stylesheet is not source-mounted");
if (compactCss.includes("transform:scale")) throw new Error("whole-screen scale is prohibited");
if (!compactCss.includes("@mediaprint")) throw new Error("print isolation guard missing");
if (compactCss.includes("max-width:760px")) throw new Error("desktop layer must not override approved mobile breakpoint");
console.log("Desktop compact responsive regression PASS");
