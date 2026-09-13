"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { supabase } from "./supabase";

const SECURITY_ACK_KEY = "icb-security-alert-ack-v1";
const SECURITY_PENDING_KEY = "icb-security-alert-pending-v1";

type SecurityAlert = {
  severity: "warning" | "high";
  alert_code: string;
  occurred_at: string | null;
  message: string;
};

function todayJst() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

function addDays(day: string, delta: number) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

function mondayOf(day: string) {
  const d = new Date(`${day}T00:00:00Z`);
  const dow = d.getUTCDay();
  return addDays(day, dow === 0 ? -6 : 1 - dow);
}

function fingerprint(alert: SecurityAlert | null) {
  if (!alert) return "";
  return [alert.alert_code, alert.occurred_at || "", alert.message].join("|");
}

function makeButton(label: string, className: string, onClick: () => void) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}

function replaceSchedulingCopy(root: ParentNode) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let node = walker.nextNode();
  while (node) {
    nodes.push(node as Text);
    node = walker.nextNode();
  }
  for (const textNode of nodes) {
    const value = textNode.nodeValue || "";
    if (!value.includes("予約変更") && !value.includes("かんたん予約変更")) continue;
    textNode.nodeValue = value
      .replaceAll("かんたん予約変更", "予定詳細")
      .replaceAll("予約変更", "予定詳細");
  }
  document.querySelectorAll<HTMLElement>("[aria-label]").forEach((element) => {
    const label = element.getAttribute("aria-label") || "";
    if (label.includes("予約を変更")) {
      element.setAttribute("aria-label", label.replaceAll("予約を変更", "予定詳細を開く"));
    }
  });
}

export default function ResponsiveUxController() {
  const pathname = usePathname() || "/";

  useEffect(() => {
    document.body.dataset.uxRoute = pathname;
    let latestAlert: SecurityAlert | null = null;
    let disposed = false;

    async function loadLatestSecurityAlert() {
      if (pathname !== "/" && pathname !== "/settings/login-history") return;
      const { data, error } = await supabase.rpc("my_login_security_alerts", { p_limit: 1 });
      if (disposed || error) return;
      latestAlert = ((data || [])[0] || null) as SecurityAlert | null;
      applyUx();
    }

    function reportDay() {
      const params = new URLSearchParams(location.search);
      return /^\d{4}-\d{2}-\d{2}$/.test(params.get("day") || "") ? params.get("day")! : todayJst();
    }

    function addDailyReportShortcuts() {
      const go = () => location.assign(`/schedule/print?day=${encodeURIComponent(reportDay())}`);
      if (pathname === "/") {
        const mobile = document.querySelector<HTMLElement>(".mobileActions");
        if (mobile && !mobile.querySelector(".uxDailyReportShortcut")) {
          const button = makeButton("日報", "uxDailyReportShortcut", go);
          mobile.insertBefore(button, mobile.children[1] || null);
        }
        const desktop = document.querySelector<HTMLElement>(".desktopTools");
        if (desktop && !desktop.querySelector(".uxDailyReportShortcut")) {
          const button = makeButton("日報を開く", "uxDailyReportShortcut", go);
          const small = document.createElement("small");
          small.textContent = "今日の日報・A3印刷";
          button.appendChild(small);
          desktop.insertBefore(button, desktop.firstChild);
        }
      }
      if (pathname === "/schedule") {
        const top = document.querySelector<HTMLElement>("main .top");
        if (top && !top.querySelector(".uxDailyReportShortcut")) {
          top.appendChild(makeButton("日報", "uxDailyReportShortcut", go));
        }
      }
    }

    function applySecurityAcknowledgement() {
      if (!latestAlert) return;
      const current = fingerprint(latestAlert);
      if (pathname === "/") {
        const notice = Array.from(document.querySelectorAll<HTMLElement>(".notice"))
          .find((element) => element.textContent?.includes("セキュリティ確認"));
        if (!notice) return;
        const acknowledged = localStorage.getItem(SECURITY_ACK_KEY) || "";
        notice.style.display = acknowledged === current ? "none" : "";
        notice.dataset.securityFingerprint = current;
      }
      if (pathname === "/settings/login-history") {
        const alertCard = Array.from(document.querySelectorAll<HTMLElement>(".notice"))
          .find((element) => element.textContent?.includes("自動検知した要注意ログイン"));
        if (!alertCard || alertCard.querySelector(".uxSecurityAck")) return;
        const ack = makeButton("確認済みにする", "uxSecurityAck", () => {
          localStorage.setItem(SECURITY_ACK_KEY, current);
          sessionStorage.removeItem(SECURITY_PENDING_KEY);
          ack.textContent = "確認済み";
          ack.setAttribute("disabled", "true");
        });
        const already = localStorage.getItem(SECURITY_ACK_KEY) === current;
        if (already) {
          ack.textContent = "確認済み";
          ack.setAttribute("disabled", "true");
        }
        alertCard.appendChild(ack);
      }
    }

    function applyUx() {
      replaceSchedulingCopy(document.body);
      addDailyReportShortcuts();
      applySecurityAcknowledgement();
      if (pathname === "/schedule/week") {
        const hint = document.querySelector<HTMLElement>(".hint");
        if (hint) hint.textContent = "横にスクロールすると1週間を続けて確認できます。予定カードから予定詳細を開けます。";
      }
    }

    function captureClick(event: MouseEvent) {
      const target = event.target as HTMLElement | null;
      if (!target) return;

      if (pathname === "/") {
        const securityNotice = target.closest<HTMLElement>(".notice");
        if (securityNotice?.textContent?.includes("セキュリティ確認") && latestAlert) {
          sessionStorage.setItem(SECURITY_PENDING_KEY, fingerprint(latestAlert));
        }

        const scheduleRow = target.closest<HTMLElement>(".homeWeekRow");
        if (scheduleRow) {
          const dayCard = scheduleRow.closest<HTMLElement>(".homeWeekDay");
          const cards = Array.from(document.querySelectorAll<HTMLElement>(".homeWeekDay"));
          const index = dayCard ? cards.indexOf(dayCard) : -1;
          if (index >= 0) {
            event.preventDefault();
            event.stopPropagation();
            location.assign(`/schedule?day=${addDays(mondayOf(todayJst()), index)}`);
          }
        }
      }
    }

    document.addEventListener("click", captureClick, true);
    const observer = new MutationObserver(() => applyUx());
    observer.observe(document.body, { childList: true, subtree: true });
    applyUx();
    void loadLatestSecurityAlert();

    return () => {
      disposed = true;
      observer.disconnect();
      document.removeEventListener("click", captureClick, true);
      delete document.body.dataset.uxRoute;
    };
  }, [pathname]);

  return (
    <style jsx global>{`
      @media screen {
        body[data-ux-route="/settings/business-calendar"] .calendarPage{display:flex;flex-direction:column}
        body[data-ux-route="/settings/business-calendar"] .calendarPage>.top{order:0}
        body[data-ux-route="/settings/business-calendar"] .calendarHead{order:1}
        body[data-ux-route="/settings/business-calendar"] .monthsGrid{order:2}
        body[data-ux-route="/settings/business-calendar"] .helpCard{order:3}
        body[data-ux-route="/settings/business-calendar"] .importCard{order:4;margin-top:12px!important}
        body[data-ux-route="/settings/business-calendar"] .importCard:before{content:"年間カレンダー設定";display:block;font-weight:900;font-size:14px;margin-bottom:7px;color:#334155}

        body[data-ux-route="/schedule/week"] .attentionBar{display:none!important}
        body[data-ux-route="/schedule/week"] .weekSummary{display:flex!important;gap:6px!important;overflow-x:auto!important}
        body[data-ux-route="/schedule/week"] .weekSummary>div{display:flex!important;align-items:center!important;gap:5px!important;min-width:max-content!important;padding:7px 9px!important;border-radius:10px!important}
        body[data-ux-route="/schedule/week"] .weekSummary span,
        body[data-ux-route="/schedule/week"] .weekSummary b,
        body[data-ux-route="/schedule/week"] .weekSummary small{font-size:11px!important;margin:0!important}
        body[data-ux-route="/schedule/week"] .weekSummary>div:nth-child(4) span{font-size:0!important}
        body[data-ux-route="/schedule/week"] .weekSummary>div:nth-child(4) span:after{content:"残";font-size:11px!important}

        .uxDailyReportShortcut{font-weight:900!important;background:#f2f7ff!important;color:#205fbf!important;border:1px solid #bcd0ee!important}
        .desktopTools .uxDailyReportShortcut{display:grid!important;gap:4px!important;text-align:left!important}
        .uxSecurityAck{margin-top:10px!important;padding:8px 11px!important;background:#fff!important;color:#245fae!important;border:1px solid #9bbce6!important}
        .uxSecurityAck:disabled{color:#52705e!important;border-color:#b9d8c3!important;background:#f2faf4!important;opacity:1!important}
      }

      @media screen and (max-width:760px){
        body[data-ux-route] main{padding-top:6px!important}
        body[data-ux-route] .top{margin-bottom:5px!important;min-height:36px!important;gap:5px!important}
        body[data-ux-route] .top button{min-height:36px!important;padding:6px 8px!important;font-size:11px!important}
        body[data-ux-route] .top strong,body[data-ux-route] .top b{font-size:12px!important}
        body[data-ux-route] .card{border-radius:13px!important;padding:11px!important;margin-bottom:8px!important}
        body[data-ux-route] .card h1,body[data-ux-route] h1{font-size:19px!important;line-height:1.2!important;margin:2px 0 7px!important}
        body[data-ux-route] .card h2,body[data-ux-route] h2{font-size:14px!important;line-height:1.25!important;margin:8px 0 6px!important}
        body[data-ux-route] .eyebrow{font-size:10px!important;line-height:1.2!important}
        body[data-ux-route] .notice{padding:7px 8px!important;margin-top:5px!important;margin-bottom:6px!important;font-size:11px!important;line-height:1.35!important}
        body[data-ux-route] .actions{gap:5px!important;margin-top:6px!important}

        body[data-ux-route="/schedule/week"] .weekPage{padding:6px 6px 34px!important}
        body[data-ux-route="/schedule/week"] .weekHero{padding:8px 9px!important;border-radius:13px!important;margin-bottom:5px!important;display:grid!important;gap:5px!important}
        body[data-ux-route="/schedule/week"] .weekHero .eyebrow{font-size:10px!important}
        body[data-ux-route="/schedule/week"] .weekHero h1{font-size:17px!important;margin:1px 0!important}
        body[data-ux-route="/schedule/week"] .weekHero p{display:none!important}
        body[data-ux-route="/schedule/week"] .weekNav{margin-top:2px!important;display:grid!important;grid-template-columns:repeat(4,minmax(0,1fr))!important;gap:4px!important}
        body[data-ux-route="/schedule/week"] .weekNav button{min-width:0!important;padding:6px 2px!important;font-size:10px!important;min-height:36px!important}
        body[data-ux-route="/schedule/week"] .jumpBar{padding:6px 8px!important;margin-bottom:5px!important;border-radius:11px!important;display:grid!important;grid-template-columns:1fr auto!important;gap:5px!important}
        body[data-ux-route="/schedule/week"] .jumpBar label{display:grid!important;grid-template-columns:auto 1fr!important;align-items:center!important;gap:5px!important;font-size:10px!important}
        body[data-ux-route="/schedule/week"] .jumpBar input{padding:6px!important;min-height:34px!important}
        body[data-ux-route="/schedule/week"] .jumpBar button{padding:6px 8px!important;min-height:34px!important;font-size:10px!important}
        body[data-ux-route="/schedule/week"] .weekSummary{margin-bottom:5px!important}
        body[data-ux-route="/schedule/week"] .hint{font-size:10px!important;margin-top:4px!important}

        body[data-ux-route="/schedule/new"] .page{padding:6px 6px 34px!important}
        body[data-ux-route="/schedule/new"] .page>.card:first-of-type{padding:8px 10px!important}
        body[data-ux-route="/schedule/new"] .page>.card:first-of-type .notice{max-height:38px!important;overflow:auto!important}
        body[data-ux-route="/schedule/new"] .capacity{display:flex!important;gap:4px!important;overflow-x:auto!important;margin-top:5px!important}
        body[data-ux-route="/schedule/new"] .capacity>div{min-width:max-content!important;padding:5px 7px!important;border-radius:9px!important}
        body[data-ux-route="/schedule/new"] .capacity small{font-size:9px!important}
        body[data-ux-route="/schedule/new"] .capacity b{font-size:12px!important}
        body[data-ux-route="/schedule/new"] .page>.card:nth-of-type(2)>div[style]{padding:8px!important;margin:6px 0 8px!important}
        body[data-ux-route="/schedule/new"] .page>.card:nth-of-type(2)>div[style]>div[style]{font-size:11px!important;line-height:1.35!important;margin-bottom:6px!important}

        body[data-ux-route="/schedule/edit"] .editPage{padding:6px 6px 34px!important}
        body[data-ux-route="/schedule/edit"] .editPage .card{padding:10px!important}
        body[data-ux-route="/schedule/edit"] .editPage .current{margin:6px 0!important;padding:7px 8px!important;font-size:12px!important}
        body[data-ux-route="/schedule/edit"] .targetPreview{margin-top:6px!important;padding:8px!important;gap:2px!important}
        body[data-ux-route="/schedule/edit"] .targetPreview b{font-size:14px!important}
        body[data-ux-route="/schedule/edit"] .targetPreview small{font-size:10px!important;line-height:1.3!important}
        body[data-ux-route="/schedule/edit"] .timeGrid{gap:5px!important}
        body[data-ux-route="/schedule/edit"] .timeSlot{min-height:40px!important;padding:6px 4px!important;font-size:11px!important}
        body[data-ux-route="/schedule/detail"] .detailPage{padding-top:5px!important}

        body[data-ux-route="/settings/login-history"] main{padding:6px!important}
        body[data-ux-route="/settings/login-history"] .card{margin:0!important;padding:10px!important}
        body[data-ux-route="/settings/login-history"] .card>.actions:first-child{margin:0 0 5px!important}
        body[data-ux-route="/settings/login-history"] .card>p{font-size:10px!important;line-height:1.35!important;margin:4px 0 6px!important}
        body[data-ux-route="/settings/login-history"] .notice{font-size:10px!important}
        body[data-ux-route="/settings/login-history"] table{font-size:11px!important;min-width:650px!important}
        body[data-ux-route="/settings/login-history"] th,body[data-ux-route="/settings/login-history"] td{padding:5px!important}

        body[data-ux-route="/settings/business-calendar"] .calendarPage{padding:6px 6px 34px!important}
        body[data-ux-route="/settings/business-calendar"] .calendarHead{padding:8px!important;margin-bottom:6px!important}
        body[data-ux-route="/settings/business-calendar"] .titleRow h1{font-size:18px!important}
        body[data-ux-route="/settings/business-calendar"] .importCard{padding:8px!important;margin-bottom:6px!important}
        body[data-ux-route="/settings/business-calendar"] .importSteps{display:none!important}
        body[data-ux-route="/settings/business-calendar"] .importNotice{font-size:10px!important}
      }

      @media screen and (min-width:761px) and (max-width:1100px){
        body[data-ux-route] .card{padding:18px!important}
        body[data-ux-route] h1{font-size:24px!important}
        body[data-ux-route="/schedule/week"] .weekHero{padding:13px 15px!important}
        body[data-ux-route="/schedule/week"] .weekHero h1{font-size:23px!important}
        body[data-ux-route="/schedule/week"] .jumpBar{padding:9px 11px!important}
        body[data-ux-route="/settings/login-history"] main{padding-top:10px!important}
        body[data-ux-route="/settings/business-calendar"] .importCard{margin-top:10px!important}
      }

      @media screen and (min-width:1101px){
        body[data-ux-route="/schedule/week"] .weekHero{padding:14px 17px!important}
        body[data-ux-route="/schedule/week"] .weekHero h1{font-size:25px!important}
        body[data-ux-route="/schedule/new"] .page>.card:first-of-type{padding:17px 20px!important}
        body[data-ux-route="/settings/login-history"] main{padding-top:10px!important}
      }

      @media print{
        body[data-ux-route="/schedule/print"]{margin:0!important;padding:0!important;width:297mm!important;height:420mm!important;overflow:hidden!important}
        body[data-ux-route="/schedule/print"] main{margin:0!important;padding:0!important;width:297mm!important;height:420mm!important;max-width:none!important}
        body[data-ux-route="/schedule/print"] .sheet{position:absolute!important;left:0!important;top:0!important;width:297mm!important;height:420mm!important;margin:0!important;padding:0!important;transform:none!important;transform-origin:0 0!important;box-shadow:none!important}
        body[data-ux-route="/schedule/print"] .row,
        body[data-ux-route="/schedule/print"] .dateToken,
        body[data-ux-route="/schedule/print"] .secondary{transform:translateZ(0)}
      }
    `}</style>
  );
}
