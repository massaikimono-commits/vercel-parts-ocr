"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { supabase } from "./supabase";
import { clearSensitiveLocalState } from "./lib/client-security";
import { isActiveAppSession } from "./lib/auth-security";

declare global { interface Window { __icbAuthVerifiedInDocument?: boolean } }
function isVerifiedInThisDocument() { return typeof window !== "undefined" && window.__icbAuthVerifiedInDocument === true; }
function setVerifiedInThisDocument(value: boolean) { if (typeof window !== "undefined") window.__icbAuthVerifiedInDocument = value; }
function isPublicPath(pathname: string) { return pathname === "/"; }

export default function AuthRouteGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const publicPath = isPublicPath(pathname);
  const [ready, setReady] = useState(() => publicPath || isVerifiedInThisDocument());

  useEffect(() => {
    let mounted = true;
    if (publicPath) { setReady(true); return () => { mounted = false; }; }

    // Keep a verified flag on the current browser document, not in component/module lifetime.
    // A client-tree remount during SPA navigation therefore does not flash the auth-check UI.
    // A real browser reload creates a new document and still performs the full session check.
    void supabase.auth.getSession().then(async ({ data }) => {
      if (!mounted) return;
      if (!data.session || !(await isActiveAppSession(data.session))) {
        setVerifiedInThisDocument(false);
        clearSensitiveLocalState();
        if (data.session) await supabase.auth.signOut();
        location.replace("/");
        return;
      }
      setVerifiedInThisDocument(true);
      if (mounted) setReady(true);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setTimeout(() => {
        if (!mounted) return;
        void (async () => {
          if (!session || !(await isActiveAppSession(session))) {
            setVerifiedInThisDocument(false);
            clearSensitiveLocalState();
            if (session) await supabase.auth.signOut();
            if (location.pathname !== "/") location.replace("/");
            return;
          }
          setVerifiedInThisDocument(true);
          if (mounted) setReady(true);
        })();
      }, 0);
    });
    return () => { mounted = false; subscription.unsubscribe(); };
  }, [pathname, publicPath]);

  if (publicPath) return <>{children}</>;
  if (!ready) return <main style={{ maxWidth: 720, margin: "0 auto", padding: "32px 16px" }}><section className="card"><h1>ログイン確認中…</h1></section></main>;
  return <>{children}</>;
}
