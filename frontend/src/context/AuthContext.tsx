// Makes "who is logged in right now" available to any page in the
// app, without passing it down manually through every component.
// Also handles saving/clearing the login token in the browser.

import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { api } from "../services/api";
import { AuthUser } from "../types";

interface RegisterInput {
  fullName: string;
  mobile: string;
  email?: string;
  password: string;
  address: string;
  district: string;
  state: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (mobileOrEmail: string, password: string) => Promise<AuthUser>;
  register: (data: RegisterInput) => Promise<AuthUser>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  // On first load, restore the session from what was saved last time
  // the person logged in, so refreshing the page doesn't log them out.
  useEffect(() => {
    const savedUser = localStorage.getItem("user");
    if (savedUser) {
      setUser(JSON.parse(savedUser));
    }
    setLoading(false);
  }, []);

  function persistSession(token: string, authUser: AuthUser) {
    localStorage.setItem("token", token);
    localStorage.setItem("user", JSON.stringify(authUser));
    setUser(authUser);
  }

  async function login(mobileOrEmail: string, password: string) {
    const res = await api.post("/auth/login", { mobileOrEmail, password });
    const authUser: AuthUser = res.data.user;
    persistSession(res.data.token, authUser);
    return authUser;
  }

  async function register(data: RegisterInput) {
    const res = await api.post("/auth/register", data);
    const authUser: AuthUser = res.data.user;
    persistSession(res.data.token, authUser);
    return authUser;
  }

  function logout() {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
