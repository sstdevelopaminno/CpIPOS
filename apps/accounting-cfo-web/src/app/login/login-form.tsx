"use client";

import { useActionState } from "react";
import { loginAction, type LoginState } from "./actions";

const initialState: LoginState = {};

export function LoginForm() {
  const [state, action, pending] = useActionState(loginAction, initialState);

  return (
    <form action={action} className="loginCard">
      <div>
        <p className="eyebrow">CUTTING POINT TECH</p>
        <h1>Accounting & CFO</h1>
        <p className="muted">ระบบดูบัญชีบริษัทบนมือถือ แยกจากระบบ POS</p>
      </div>

      <label>
        สิทธิ์ผู้ใช้งาน
        <select name="role" defaultValue="cfo">
          <option value="cfo">Accounting / CFO</option>
          <option value="marketing">ฝ่ายบริหารการตลาด</option>
        </select>
      </label>

      <label>
        รหัสเข้าใช้งาน
        <input name="accessKey" type="password" autoComplete="current-password" minLength={16} required />
      </label>

      {state.error ? <p className="errorBox">{state.error}</p> : null}

      <button className="primaryButton" type="submit" disabled={pending}>
        {pending ? "กำลังตรวจสอบ..." : "เข้าสู่ระบบ"}
      </button>

      <p className="tiny muted">
        รหัสและ session ของระบบนี้ไม่ใช้ร่วมกับ POS และไม่มีการเขียนข้อมูลลงฐาน POS
      </p>
    </form>
  );
}
