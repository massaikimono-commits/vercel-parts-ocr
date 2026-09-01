"use client";

import { useEffect } from "react";
import { supabase } from "./supabase";
import { clearSensitiveLocalState } from "./lib/client-security";

const IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const ABSOLUTE_TIMEOUT_MS = 12 * 60 * 60 * 1000;
const LAST_ACTIVITY_KEY = "icb-last-activity-at";
const SESSION_STARTED_KEY = "icb-session-started-at";
const ACTIVITY_WRITE_THROTTLE_MS = 30 * 1000;
const AUTO_LOGOUT_REASON_KEY = "icb-auto-logout-reason";

function readTime(key: string) {
  try {
    const value = Number(localStorage.getItem(key) || "0");
    return Number.isFinite(value) && value > 0 ? value : 0;
  } catch {
    return 0;
  }
}

function writeTime(key: string, value: number) {
  try {
    localStorage.setItem(key, String(value));
  } catch {}
}

function ensureSessionTimes(now = Date.now()) {
  if (!readTime(SESSION_STARTED_KEY)) writeTime(SESSION_STARTED_KEY, now);
  if (!readTime(LAST_ACTIVITY_KEY)) writeTime(LAST_ACTIVITY_KEY, now);
}

function recordActivity() {
  const now = Date.now();
  const previous = readTime(LAST_ACTIVITY_KEY);
  if (!previous || now - previous >= ACTIVITY_WRITE_THROTTLE_MS) {
    writeTime(LAST_ACTIVITY_KEY, now);
  }
}

function expiryReason(now = Date.now()): "idle" | "absolute" | null {
  const started = readTime(SESSION_STARTED_KEY);
  const last = readTime(LAST_ACTIVITY_KEY);
  if (!started || !last) return null;
  if (now - last >= IDLE_TIMEOUT_MS) return "idle";
  if (now - started >= ABSOLUTE_TIMEOUT_MS) return "absolute";
  return null;
}

function sessionExpired(now = Date.now()) {
  return expiryReason(now) !== null;
}

export default function SessionLifetimeGuard() {
  useEffect(() => {
    let stopped = false;
    let signingOut = false;
    let hasSession = false;

    const signOutExpiredSession = async () => {
      if (stopped || signingOut) return false;
      const { data } = await supabase.auth.getSession();
      if (!data.session) return false;
      ensureSessionTimes();
      const reason = expiryReason();
      if (!reason) return false;

      signingOut = true;
      try {
        await supabase.rpc("record_logout");
      } catch {}
      try {
        sessionStorage.setItem(AUTO_LOGOUT_REASON_KEY, reason);
      } catch {}
      clearSensitiveLocalState();
      await supabase.auth.signOut({ scope: "local" });
      if (location.pathname !== "/") location.replace("/");
      else location.reload();
      return true;
    };

    void supabase.auth.getSession().then(({ data }) => {
      hasSession = Boolean(data.session);
      if (data.session) ensureSessionTimes();
    });

    const activityEvents: Array<keyof WindowEventMap> = [
      "pointerdown",
      "keydown",
      "touchstart",
      "scroll",
    ];
    const onActivity = () => {
      if (!hasSession) return;
      if (sessionExpired()) {
        void signOutExpiredSession();
        return;
      }
      recordActivity();
    };
    for (const eventName of activityEvents) {
      window.addEventListener(eventName, onActivity, { passive: true });
    }

    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      void signOutExpiredSession().then((expired) => {
        if (!expired) recordActivity();
      });
    };
    document.addEventListener("visibilitychange", onVisible);

    const onPageShow = () => {
      void (async () => {
        const { data } = await supabase.auth.getSession();
        if (!data.session) {
          clearSensitiveLocalState();
          if (location.pathname !== "/") location.replace("/");
          return;
        }
        await signOutExpiredSession();
      })();
    };
    window.addEventListener("pageshow", onPageShow);

    const timer = window.setInterval(() => {
      void signOutExpiredSession();
    }, 60 * 1000);

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      hasSession = Boolean(session);
      if (event === "SIGNED_IN" && session) ensureSessionTimes();
      if (event === "SIGNED_OUT") clearSensitiveLocalState();
    });

    return () => {
      stopped = true;
      window.clearInterval(timer);
      for (const eventName of activityEvents) {
        window.removeEventListener(eventName, onActivity);
      }
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", onPageShow);
      subscription.unsubscribe();
    };
  }, []);

  return null;
}
