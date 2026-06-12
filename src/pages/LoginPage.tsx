import {
  Button,
  Card,
  CardContent,
  Field,
  Input,
  Logo,
  Spinner,
} from "@chipmo-sentry/ui-kit";
import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";

import { useAuth } from "@/context/AuthContext";
import { ApiError } from "@/lib/api";

export function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Still checking the existing session → avoid flashing the form.
  if (user === null) {
    return (
      <div className="grid h-full place-items-center bg-[var(--color-muted)]">
        <Spinner />
      </div>
    );
  }
  // Already signed in → bounce to the dashboard.
  if (user) return <Navigate to="/" replace />;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(email.trim(), password);
      navigate("/", { replace: true });
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 401
          ? "И-мэйл эсвэл нууц үг буруу байна"
          : err instanceof Error
            ? err.message
            : "Нэвтэрч чадсангүй",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid h-full place-items-center bg-[var(--color-muted)] p-4">
      <Card className="w-full max-w-sm">
        <CardContent className="space-y-6 p-8">
          <div className="flex flex-col items-center gap-2">
            <Logo className="h-9 w-auto" />
            <h1 className="text-lg font-semibold">Super Admin нэвтрэх</h1>
          </div>
          <form className="space-y-4" onSubmit={onSubmit}>
            <Field label="И-мэйл" required>
              <Input
                type="email"
                required
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@chipmo.mn"
                disabled={busy}
              />
            </Field>
            <Field label="Нууц үг" required>
              <Input
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={busy}
                autoComplete="current-password"
              />
            </Field>
            {error && (
              <p className="text-sm text-[var(--color-danger)]">{error}</p>
            )}
            <Button
              type="submit"
              className="w-full"
              disabled={busy || !email.trim() || password.length < 8}
            >
              {busy ? "Нэвтэрч байна…" : "Нэвтрэх"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
