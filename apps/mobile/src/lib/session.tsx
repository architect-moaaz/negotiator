import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { request, type Result, type Tokens } from "./api";
import { registerForPush, unregisterPush } from "./push";
import { storage } from "./storage";

type Kind = "buyer" | "member";
interface Session {
  ready: boolean;
  tokens: Tokens;
  pushToken?: string;
  pushNote?: string;
  signIn: (kind: Kind, token: string) => Promise<void>;
  signOut: (kind: Kind) => Promise<void>;
  /** An API call with this phone's sessions attached. */
  api: <T>(path: string, init?: { method?: string; body?: unknown }) => Promise<Result<T>>;
}

const Ctx = createContext<Session | null>(null);
const KEY: Record<Kind, string> = { buyer: "gc.buyer", member: "gc.member" };

export function SessionProvider({ children }: { children: ReactNode }) {
  const [tokens, setTokens] = useState<Tokens>({});
  const [ready, setReady] = useState(false);
  const [push, setPush] = useState<{ token?: string; reason?: string }>({});

  useEffect(() => {
    (async () => {
      const [buyer, member] = await Promise.all([storage.get(KEY.buyer), storage.get(KEY.member)]);
      setTokens({ buyer: buyer ?? undefined, member: member ?? undefined });
      setReady(true);
    })();
  }, []);

  // Whenever who's signed in changes, (re)register this phone for their notifications.
  useEffect(() => {
    if (!ready || (!tokens.buyer && !tokens.member)) return;
    registerForPush(tokens).then(setPush);
  }, [ready, tokens]);

  const signIn = useCallback(async (kind: Kind, token: string) => {
    await storage.set(KEY[kind], token);
    setTokens((t) => ({ ...t, [kind]: token }));
  }, []);

  const signOut = useCallback(
    async (kind: Kind) => {
      // Only this role's session: signing out of the store keeps the shopper's notifications, and vice versa.
      const only: Tokens = { [kind]: tokens[kind] };
      if (push.token) await unregisterPush(only, push.token);
      await request(only, "/api/auth/logout", { body: { role: kind } });
      await storage.remove(KEY[kind]);
      setTokens((t) => ({ ...t, [kind]: undefined }));
    },
    [push.token, tokens],
  );

  const value = useMemo<Session>(
    () => ({ ready, tokens, pushToken: push.token, pushNote: push.reason, signIn, signOut, api: (path, init) => request(tokens, path, init) }),
    [ready, tokens, push, signIn, signOut],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession() {
  const s = useContext(Ctx);
  if (!s) throw new Error("useSession outside SessionProvider");
  return s;
}
