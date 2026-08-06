import { AuthShell } from "@/components/auth/auth-shell";
import { StoreLoginForm } from "@/components/auth/store-login-form";

export default function StoreLoginPage() {
  return (
    <AuthShell title="เข้าสู่ระบบร้าน" subtitle="CpIPOS Mobile">
      <StoreLoginForm />
    </AuthShell>
  );
}
