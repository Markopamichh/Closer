import { LoginForm } from "@/components/auth/login-form";
import { safeNextPath } from "@/lib/safe-redirect";

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next } = await searchParams;
  return <LoginForm next={safeNextPath(next)} />;
}
