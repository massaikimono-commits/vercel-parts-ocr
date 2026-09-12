import fs from "node:fs";

const shell = fs.readFileSync("app/layout.tsx", "utf8");
const nav = fs.readFileSync("app/mobile-quick-nav.tsx", "utf8");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(shell.includes('import MobileQuickNav from "./mobile-quick-nav";'), "app shell must import MobileQuickNav");
assert(shell.includes("<MobileQuickNav />"), "app shell must render MobileQuickNav inside the guarded app");
assert(nav.includes('href: "/schedule/new"'), "mobile quick nav must include schedule registration");
assert(nav.includes('href: "/schedule/search"'), "mobile quick nav must include schedule search");
assert(nav.includes('href: "/customer-vehicles"'), "mobile quick nav must include customer/vehicle management");
assert(nav.includes('href: "/"'), "mobile quick nav must include home");
assert(nav.includes('"/parts-print"'), "parts print route must suppress quick nav");
assert(nav.includes('"/inspection/print"'), "inspection print route must suppress quick nav");
assert(nav.includes('"/schedule/print"'), "schedule print route must suppress quick nav");
assert(nav.includes("@media(max-width:760px)"), "quick nav must be mobile-only");
assert(nav.includes("env(safe-area-inset-bottom)"), "quick nav must respect iPhone safe area");
assert(nav.includes("@media print"), "quick nav must be hidden for printing");
assert(nav.includes('pathname === "/schedule" || pathname.startsWith("/schedule/")'), "schedule routes must enable context navigation");
assert(nav.includes('timeZone: "Asia/Tokyo"'), "Today shortcut must use JST day semantics");
assert(nav.includes('`/schedule?day=${todayJst()}`'), "schedule context must provide one-tap Today daily schedule");
assert(nav.includes('className="todayShortcut"'), "Today action must remain visually distinct from current-route active state");
assert(nav.includes("repeat(5,minmax(0,1fr))"), "schedule context must fit the additional Today action without overlaying existing actions");
assert(nav.includes("@media(max-width:360px)"), "narrow iPhone widths must keep schedule-context labels compact");
assert(!nav.includes("supabase"), "quick nav must not add database traffic");
assert(!nav.includes("fetch("), "quick nav must not add network fetches");
assert(!nav.includes("/ocr/auto"), "quick nav must not couple global navigation to OCR execution");

console.log("Mobile quick nav regression: PASS");
