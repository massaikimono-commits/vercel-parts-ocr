"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { supabase } from "./supabase";
import { clearSensitiveLocalState } from "./lib/client-security";

function isPublicPath(pathname: string) {
  // 現在の公開入口はログイン画面の / のみ。
  // 将来お客様向け公開ページを追加する場合は、ここへ明示的に追加する。
  return pathname === "/";
}

export default function AuthRouteGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const publicPath = isPublicPath(pathname);
  const [ready, setReady] = useState(publicPath);

  useEffect(() => {
    let mounted = true;

    if (publicPath) {
      setReady(true);
      return () => {
        mounted = false;
      };
    }

    setReady(false);

    void supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      if (!data.session) {
        clearSensitiveLocalState();
        location.replace("/");
        return;
      }
      setReady(true);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session && location.pathname !== "/") {
        clearSensitiveLocalState();
        location.replace("/");
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [pathname, publicPath]);

  if (publicPath) return <>{children}</>;

  if (!ready) {
    return (
      <main style={{ maxWidth: 720, margin: "0 auto", padding: "32px 16px" }}>
        <section className="card">
          <h1>ログイン確認中…</h1>
        </section>
      </main>
    );
  }

  return <>{children}</>;
}
