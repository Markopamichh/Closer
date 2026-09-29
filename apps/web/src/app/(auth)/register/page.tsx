import { RegisterForm } from "@/components/auth/register-form";
import { safeNextPath } from "@/lib/safe-redirect";

export default async function RegisterPage({ searchParams }: PageProps<"/register">) {
  const { next } = await searchParams;
  return <RegisterForm next={safeNextPath(next)} />;
}
