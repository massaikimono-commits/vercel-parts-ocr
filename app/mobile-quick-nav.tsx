"use client";

import { usePathname } from "next/navigation";

const HIDDEN_PREFIXES = [
  "/parts-print",
  "/inspection/print",
  "/schedule/print",
];

const ITEMS = [
  { href: "/", label: "ホーム", icon: "⌂" },
  { href: "/schedule/new", label: "予定登録", icon: "＋" },
  { href: "/schedule/search", label: "予定検索", icon: "⌕" },
  { href: "/customer-vehicles", label: "顧客車両", icon: "車" },
] as const;

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  if (href === "/schedule/new") return pathname === "/schedule/new";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function MobileQuickNav() {
  const pathname = usePathname() || "/";

  if (HIDDEN_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) {
    return null;
  }

  return (
    <nav className="mobileQuickNav" aria-label="スマホ共通ショートカット">
      {ITEMS.map((item) => {
        const active = isActive(pathname, item.href);
        return (
          <a
            key={item.href}
            href={item.href}
            className={active ? "active" : ""}
            aria-current={active ? "page" : undefined}
          >
            <span aria-hidden="true">{item.icon}</span>
            <b>{item.label}</b>
          </a>
        );
      })}
      <style jsx global>{`
        .mobileQuickNav{display:none}
        @media(max-width:760px){
          body{padding-bottom:calc(66px + env(safe-area-inset-bottom))}
          .mobileQuickNav{position:fixed;z-index:1000;left:8px;right:8px;bottom:max(7px,env(safe-area-inset-bottom));display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:4px;padding:5px;background:rgba(255,255,255,.96);border:1px solid #d6dfeb;border-radius:16px;box-shadow:0 8px 28px rgba(20,35,55,.18);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px)}
          .mobileQuickNav a{min-width:0;min-height:48px;border-radius:11px;text-decoration:none;color:#66758a;display:grid;place-items:center;align-content:center;gap:1px;font-size:11px;font-weight:900;-webkit-tap-highlight-color:transparent}
          .mobileQuickNav a>span{font-size:17px;line-height:1}
          .mobileQuickNav a>b{font-size:10px;line-height:1.2;white-space:nowrap}
          .mobileQuickNav a.active{background:#eef4ff;color:#245fae}
          .mobileQuickNav a:focus-visible{outline:3px solid #72a7ed;outline-offset:1px}
        }
        @media print{.mobileQuickNav{display:none!important}body{padding-bottom:0!important}}
      `}</style>
    </nav>
  );
}
