"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { registerInternalNavigationRouter } from "./lib/internal-navigation";

export default function InternalNavigationBridge() {
  const router = useRouter();

  useEffect(() => {
    registerInternalNavigationRouter(router);
    return () => registerInternalNavigationRouter(null);
  }, [router]);

  return null;
}
