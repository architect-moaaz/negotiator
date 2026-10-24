"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

/** "Log in" or "My deals", depending on whether a shopper session exists. */
export function AccountLink() {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  useEffect(() => {
    fetch("/api/me", { cache: "no-store" })
      .then((r) => r.json())
      .then((u) => setSignedIn(!!u))
      .catch(() => setSignedIn(false));
  }, []);
  if (signedIn === null) return null;
  return (
    <Link href={signedIn ? "/account" : "/login"} className="text-muted hover:text-fg">
      {signedIn ? "My deals" : "Log in"}
    </Link>
  );
}
