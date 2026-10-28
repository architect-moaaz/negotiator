"use client";

import { useRouter } from "next/navigation";
import { LANG_COOKIE, LANG_NAMES, LANGS, type Lang } from "@/lib/i18n";

/** English / हिन्दी. Remembered for a year in this browser. */
export function LanguageSwitch({ lang }: { lang: Lang }) {
  const router = useRouter();
  return (
    <div role="group" aria-label="Language" className="flex gap-2 text-sm">
      {LANGS.map((l) => (
        <button
          key={l}
          lang={l}
          aria-pressed={lang === l}
          onClick={() => {
            document.cookie = `${LANG_COOKIE}=${l}; path=/; max-age=31536000; samesite=lax`;
            router.refresh();
          }}
          className={lang === l ? "text-fg underline underline-offset-4" : "text-muted hover:text-fg"}
        >
          {LANG_NAMES[l]}
        </button>
      ))}
    </div>
  );
}
