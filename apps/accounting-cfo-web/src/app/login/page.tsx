import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { LoginForm } from "./login-form";

export default async function LoginPage() {
  if (await getSession()) redirect("/");

  return (
    <main className="loginPage">
      <LoginForm />
    </main>
  );
}
