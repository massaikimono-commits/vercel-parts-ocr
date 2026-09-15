"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const HIDDEN_PREFIXES = [
  "/parts-print",
  "/inspection/print",
  "/schedule/print",
];

const ITEMS = [
  { href: "/", label: "ホーム" },
  { href: "/schedule/new", label: "予定登録" },
  { href: "/schedule/search", label: "予定検索" },
  { href: "/customer-vehicles", label: "顧客車両" },
] as const;

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  if (href === "/schedule/new") return pathname === "/schedule/new";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function todayJst() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export default function DesktopQuickNav() {
  const pathname = usePathname() || "/";
  const todayHref = `/schedule?day=${todayJst()}`;

  // Root is also the login route. Keep the login screen clean; the signed-in home
  // already exposes the same primary actions directly in its compact dashboard.
  if (pathname === "/") return null;
  if (HIDDEN_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) return null;

  const todayActive = pathname === "/schedule" &&
    (typeof window === "undefined" || !new URLSearchParams(window.location.search).get("day") ||
      new URLSearchParams(window.location.search).get("day") === todayJst());

  return (
    <>
      <nav className="desktopQuickNav" aria-label="PC共通ショートカット">
        {ITEMS.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <Link key={item.href} href={item.href} prefetch={true} className={active ? "active" : ""} aria-current={active ? "page" : undefined}>
              {item.label}
            </Link>
          );
        })}
        <Link href={todayHref} prefetch={true} className={todayActive ? "active today" : "today"} aria-current={todayActive ? "page" : undefined}>
          今日
        </Link>
      </nav>
      <div className="desktopQuickNavSpacer" aria-hidden="true" />
      <style jsx global>{`
        .desktopQuickNav,.desktopQuickNavSpacer{display:none}
        @media(min-width:981px){
          .desktopQuickNav{position:fixed;z-index:950;top:0;left:0;right:0;height:38px;display:flex;align-items:center;justify-content:center;gap:4px;padding:3px 12px;background:rgba(255,255,255,.97);border-bottom:1px solid #d8e0ea;box-shadow:0 2px 10px rgba(20,35,55,.08);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px)}
          .desktopQuickNav a{display:flex;align-items:center;justify-content:center;min-width:84px;height:30px;padding:0 12px;border-radius:8px;text-decoration:none;color:#52647a;font-size:12px;line-height:1;font-weight:800;white-space:nowrap}
          .desktopQuickNav a:hover{background:#f2f6fb;color:#244e82}
          .desktopQuickNav a.active{background:#e9f1fc;color:#174f91}
          .desktopQuickNav a.today{min-width:66px}
          .desktopQuickNav a:focus-visible{outline:3px solid #72a7ed;outline-offset:1px}
          .desktopQuickNavSpacer{display:block;height:38px}
        }
        @media print{.desktopQuickNav,.desktopQuickNavSpacer{display:none!important}}
      `}</style>
    </>
  );
}
