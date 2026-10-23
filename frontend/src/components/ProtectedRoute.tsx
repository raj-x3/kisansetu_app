import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { Role } from "../types";

export function ProtectedRoute({
  children,
  allowedRoles,
}: {
  children: JSX.Element;
  allowedRoles: Role[];
}) {
  const { user, loading } = useAuth();

  if (loading) return null; // avoid a flash-redirect while we check localStorage

  if (!user) return <Navigate to="/login" replace />;

  if (!allowedRoles.includes(user.role)) {
    // Logged in, but the wrong kind of account for this page.
    return <Navigate to="/login" replace />;
  }

  return children;
}
