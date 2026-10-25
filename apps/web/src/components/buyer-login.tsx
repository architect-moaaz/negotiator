"use client";

import { useRouter } from "next/navigation";
import { PhoneLogin } from "./phone-login";

export function BuyerLogin() {
  const router = useRouter();
  return <PhoneLogin role="buyer" onDone={() => router.push("/account")} />;
}
