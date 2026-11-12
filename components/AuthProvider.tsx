"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

const API = process.env.NEXT_PUBLIC_API_BASE ?? "/api";
const ACCESS = "esstorah.accessToken";
const REFRESH = "esstorah.refreshToken";
const USER_NAME = "esstorah.userName";
const VERIFIER = "esstorah.pkceVerifier";
const RETURN_PATH = "esstorah.returnPath";

export type Bookmark = {
  id: number;
  parasha: string;
  ref: string;
  kind: "question" | "answer";
  text: string;
  created_at: string;
};
export type BookmarkInput = Pick<Bookmark, "parasha" | "ref" | "kind" | "text">;

type AuthContextValue = {
  ready: boolean;
  authenticated: boolean;
  name: string;
  error: string;
  bookmarks: Bookmark[];
  login: () => Promise<void>;
  logout: () => void;
  toggleBookmark: (item: BookmarkInput) => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function decode(token: string): { exp?: number; name?: string; preferred_username?: string; email?: string; nickname?: string } {
  const payload = token.split(".")[1];
  if (!payload) throw new Error("Érvénytelen azonosító token.");
  const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))));
}

function displayName(token: string): string | undefined {
  const claims = decode(token);
  return claims.name || claims.preferred_username || claims.email || claims.nickname;
}

function base64url(bytes: Uint8Array) {
  return btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(""))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

type Tokens = { access_token: string; refresh_token?: string; id_token?: string };
let initialization: Promise<Tokens | null> | null = null;
let refreshInFlight: Promise<Tokens> | null = null;

async function postForm(path: string, values: Record<string, string>): Promise<Tokens> {
  const response = await fetch(`${API}/auth/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(values),
  });
  if (!response.ok) throw new Error(`A bejelentkezés nem sikerült (${response.status}).`);
  const tokens: Tokens = await response.json();
  if (!tokens.access_token) throw new Error("Az azonosító szolgáltatás nem küldött hozzáférési tokent.");
  return tokens;
}

async function initialize(): Promise<Tokens | null> {
  const params = new URLSearchParams(window.location.search);
  const error = params.get("error");
  if (error) {
    window.history.replaceState(window.history.state, "", window.location.pathname);
    throw new Error(`A bejelentkezés nem sikerült: ${error}`);
  }
  const code = params.get("code");
  if (code) {
    window.history.replaceState(window.history.state, "", window.location.pathname);
    const verifier = sessionStorage.getItem(VERIFIER);
    if (!verifier || params.get("state") !== verifier) throw new Error("Érvénytelen bejelentkezési állapot.");
    const tokens = await postForm("token", { code, code_verifier: verifier, redirect_uri: `${location.origin}/` });
    sessionStorage.removeItem(VERIFIER);
    const path = sessionStorage.getItem(RETURN_PATH);
    sessionStorage.removeItem(RETURN_PATH);
    const userName = (tokens.id_token && displayName(tokens.id_token)) || displayName(tokens.access_token);
    if (userName) localStorage.setItem(USER_NAME, userName);
    else localStorage.removeItem(USER_NAME);
    if (tokens.refresh_token) localStorage.setItem(REFRESH, tokens.refresh_token);
    else localStorage.removeItem(REFRESH);
    localStorage.setItem(ACCESS, tokens.access_token);
    location.replace(path?.startsWith("/") && !path.startsWith("//") ? path : "/");
    return null;
  }
  const access = localStorage.getItem(ACCESS);
  return access ? { access_token: access, refresh_token: localStorage.getItem(REFRESH) ?? undefined } : null;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const access = useRef("");
  const refresh = useRef("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const generation = useRef(0);

  const logout = useCallback(() => {
    generation.current++;
    access.current = "";
    refresh.current = "";
    if (timer.current) clearTimeout(timer.current);
    localStorage.removeItem(ACCESS);
    localStorage.removeItem(REFRESH);
    localStorage.removeItem(USER_NAME);
    setAuthenticated(false);
    setName("");
    setBookmarks([]);
  }, []);

  const applyTokens = useCallback((tokens: Tokens) => {
    const claims = decode(tokens.access_token);
    if (!claims.exp) throw new Error("A hozzáférési tokennek nincs lejárata.");
    access.current = tokens.access_token;
    refresh.current = tokens.refresh_token ?? refresh.current;
    const userName = (tokens.id_token && displayName(tokens.id_token)) ||
      displayName(tokens.access_token) || localStorage.getItem(USER_NAME);
    if (userName) localStorage.setItem(USER_NAME, userName);
    if (refresh.current) localStorage.setItem(REFRESH, refresh.current);
    localStorage.setItem(ACCESS, access.current);
    setName(userName || "felhasználó");
    setAuthenticated(true);
    return claims.exp;
  }, []);

  const refreshTokens = useCallback(async () => {
    if (!refresh.current) throw new Error("A munkamenet lejárt; jelentkezz be újra.");
    const currentGeneration = generation.current;
    if (!refreshInFlight) {
      refreshInFlight = postForm("refresh", { refresh_token: refresh.current }).finally(() => { refreshInFlight = null; });
    }
    const tokens = await refreshInFlight;
    if (generation.current !== currentGeneration) throw new Error("A munkamenet megszűnt.");
    applyTokens(tokens);
    return tokens.access_token;
  }, [applyTokens]);

  const request = useCallback(async (path: string, options: RequestInit = {}) => {
    if (!access.current) throw new Error("Jelentkezz be a könyvjelzőkhöz.");
    const requestGeneration = generation.current;
    const send = (token: string) => fetch(`${API}${path}`, {
      ...options,
      headers: { ...options.headers, Authorization: `Bearer ${token}` },
    });
    let response = await send(access.current);
    if (response.status === 401 && refresh.current) {
      try {
        response = await send(await refreshTokens());
      } catch (err) {
        logout();
        throw err;
      }
    }
    if (response.status === 401) {
      logout();
      throw new Error("A munkamenet lejárt; jelentkezz be újra.");
    }
    if (generation.current !== requestGeneration) throw new Error("A munkamenet megszűnt.");
    if (!response.ok) throw new Error(`A könyvjelzők kérése sikertelen (${response.status}).`);
    return response;
  }, [logout, refreshTokens]);

  const loadBookmarks = useCallback(async () => {
    const currentGeneration = generation.current;
    const response = await request("/bookmarks");
    const data: { bookmarks: Bookmark[] } = await response.json();
    if (generation.current === currentGeneration) setBookmarks(data.bookmarks);
  }, [request]);

  useEffect(() => {
    if (!initialization) initialization = initialize().finally(() => { initialization = null; });
    initialization.then(async (tokens) => {
      if (tokens) {
        refresh.current = tokens.refresh_token ?? "";
        const exp = applyTokens(tokens);
        if (exp * 1000 - Date.now() < 60000) await refreshTokens();
        await loadBookmarks();
      }
    }).catch((err: Error) => {
      setError(err.message);
      if (access.current && decode(access.current).exp! * 1000 <= Date.now()) logout();
    }).finally(() => setReady(true));
  }, [applyTokens, loadBookmarks, logout, refreshTokens]);

  useEffect(() => {
    if (!authenticated) return;
    const check = () => {
      if (!access.current) return;
      const exp = decode(access.current).exp;
      if (!exp) return;
      if (timer.current) clearTimeout(timer.current);
      const delay = exp * 1000 - Date.now() - 60000;
      timer.current = setTimeout(() => {
        refreshTokens().then(check).catch((err: Error) => { setError(err.message); logout(); });
      }, Math.max(5000, delay));
    };
    const visible = () => {
      if (document.visibilityState !== "visible" || !access.current) return;
      const exp = decode(access.current).exp;
      if (exp && exp * 1000 - Date.now() < 60000) {
        refreshTokens().then(check).catch((err: Error) => { setError(err.message); logout(); });
      } else check();
    };
    check();
    document.addEventListener("visibilitychange", visible);
    return () => {
      if (timer.current) clearTimeout(timer.current);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [authenticated, logout, refreshTokens]);

  const login = useCallback(async () => {
    try {
      setError("");
      const response = await fetch(`${API}/auth/config`);
      if (!response.ok) throw new Error("A bejelentkezés nincs beállítva.");
      const config: { issuer: string; clientId: string } = await response.json();
      const discovery = await fetch(`${config.issuer}/.well-known/openid-configuration`);
      if (!discovery.ok) throw new Error("Az azonosító szolgáltatás nem érhető el.");
      const metadata: { authorization_endpoint: string } = await discovery.json();
      const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
      const challenge = base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
      sessionStorage.setItem(VERIFIER, verifier);
      const current = new URLSearchParams(location.search);
      sessionStorage.setItem(RETURN_PATH, current.has("code") || current.has("error")
        ? location.pathname : `${location.pathname}${location.search}${location.hash}`);
      const params = new URLSearchParams({
        response_type: "code", client_id: config.clientId, redirect_uri: `${location.origin}/`,
        scope: "openid profile email offline_access", state: verifier,
        code_challenge: challenge, code_challenge_method: "S256",
      });
      location.assign(`${metadata.authorization_endpoint}?${params}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "A bejelentkezés nem sikerült.");
    }
  }, []);

  useEffect(() => {
    function onStorage(event: StorageEvent) {
      if (event.key !== ACCESS || event.newValue === access.current) return;
      if (!event.newValue) logout();
      else location.reload();
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [logout]);

  const toggleBookmark = useCallback(async (item: BookmarkInput) => {
    const currentGeneration = generation.current;
    const existing = bookmarks.find((b) =>
      b.parasha === item.parasha && b.ref === item.ref && b.kind === item.kind && b.text === item.text);
    if (existing) {
      await request(`/bookmarks/${existing.id}`, { method: "DELETE" });
      if (generation.current === currentGeneration) setBookmarks((previous) => previous.filter((b) => b.id !== existing.id));
    } else {
      const response = await request("/bookmarks", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(item),
      });
      const saved: Bookmark = await response.json();
      if (generation.current === currentGeneration) setBookmarks((previous) => [saved, ...previous.filter((b) => b.id !== saved.id)]);
    }
  }, [bookmarks, request]);

  return (
    <AuthContext.Provider value={{ ready, authenticated, name, error, bookmarks, login, logout, toggleBookmark }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("AuthProvider is missing");
  return context;
}
