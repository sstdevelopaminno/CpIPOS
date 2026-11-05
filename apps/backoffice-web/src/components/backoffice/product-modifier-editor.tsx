"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

type Ingredient = { id: string; name: string; base_unit: string; quantity_on_hand: number };
type IngredientDelta = { option_id: string; ingredient_id: string; quantity_delta_per_item: number };
type ModifierOption = {
  id: string; name: string; price_delta: number; is_default: boolean;
  is_active: boolean; ingredients: IngredientDelta[];
};
type ModifierGroup = {
  id: string; name: string; selection_type: "single" | "multiple"; is_required: boolean;
  min_select: number; max_select: number; is_active: boolean; options: ModifierOption[];
};
type ModifierData = { product: { id: string; name: string }; groups: ModifierGroup[]; ingredients: Ingredient[] };
type Envelope<T> = { data?: T; error?: { code?: string; message?: string } };
const fieldStyle = "min-h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm";
const actionStyle = "rounded-lg border border-blue-200 px-3 py-1.5 text-xs font-bold text-blue-700 hover:bg-blue-50 disabled:opacity-50";

export function ProductModifierEditor({ productId }: { productId: string }) {
  const [data, setData] = useState<ModifierData | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [editingGroup, setEditingGroup] = useState<string | null>(null);
  const [editingOption, setEditingOption] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/backoffice/product-modifiers?product_id=" +
        encodeURIComponent(productId), { cache: "no-store" });
      const json = await response.json() as Envelope<ModifierData>;
      if (!response.ok || !json.data) throw new Error(json.error?.message ?? "โหลดตัวเลือกสินค้าไม่ได้");
      setData(json.data);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "โหลดตัวเลือกสินค้าไม่ได้");
    } finally {
      setLoading(false);
    }
  }, [productId]);

  useEffect(() => { void load(); }, [load]);

  async function update(body: Record<string, unknown>, success = "บันทึกแล้ว") {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/backoffice/product-modifiers", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const json = await response.json() as Envelope<unknown>;
      if (!response.ok || json.error) throw new Error(json.error?.message ?? "ไม่สามารถบันทึกข้อมูลได้");
      setMessage(success);
      await load();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "บันทึกข้อมูลไม่ได้");
      return false;
    } finally {
      setBusy(false);
    }
  }

  const onGroup = (event: FormEvent<HTMLFormElement>, id?: string) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const required = form.get("is_required") === "on";
    const kind = String(form.get("selection_type") ?? "single");
    const min = Number(form.get("min_select") ?? 0);
    const max = Number(form.get("max_select") ?? 1);
    void update({
      action: "save_group", product_id: productId, id,
      name: String(form.get("name") ?? ""),
      selection_type: kind, is_required: required,
      min_select: required ? Math.max(min, 1) : min, max_select: max
    }).then((done) => { if (done) setEditingGroup(null); });
  };
  const onOption = (event: FormEvent<HTMLFormElement>, groupId: string, id?: string) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void update({
      action: "save_option", group_id: groupId, id,
      name: String(form.get("name") ?? ""),
      price_delta: Number(form.get("price_delta") ?? 0),
      is_default: form.get("is_default") === "on"
    }).then((done) => { if (done) setEditingOption(null); });
  };
  const onDelta = (event: FormEvent<HTMLFormElement>, optionId: string) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const ingredientId = String(form.get("ingredient_id") ?? "");
    if (!ingredientId) { setError("กรุณาเลือกวัตถุดิบ"); return; }
    void update({
      action: "save_ingredient_delta", option_id: optionId, ingredient_id: ingredientId,
      quantity_delta_per_item: Number(form.get("quantity_delta_per_item") ?? 0)
    }, "บันทึกปริมาณวัตถุดิบแล้ว");
  };
  if (loading && !data) return <p className="p-3 text-sm text-slate-600">กำลังโหลดตัวเลือกสินค้า...</p>;
  return (
    <section className="max-h-[75vh] space-y-4 overflow-y-auto pr-2 text-slate-800">
      <p className="text-sm text-slate-600">
        ตั้งค่าตัวเลือกที่ต้องแสดง POP-UP ในโหมดกลับบ้านและนั่งโต๊ะ ราคาจะคำนวณโดยเซิร์ฟเวอร์
        และหักวัตถุดิบตามสูตรที่ร้านกำหนด
      </p>
      {error ? <p role="alert" className="rounded-lg bg-red-50 p-2 text-sm text-red-700">{error}</p> : null}
      {message ? <p role="status" className="rounded-lg bg-emerald-50 p-2 text-sm text-emerald-700">{message}</p> : null}
      <form onSubmit={(e) => onGroup(e)} className="grid gap-2 rounded-xl border border-slate-200 p-3 sm:grid-cols-2">
        <h4 className="font-bold sm:col-span-2">เพิ่มกลุ่มตัวเลือกสินค้า</h4>
        <input name="name" required maxLength={120} placeholder="ตัวอย่าง: เลือกชนิดเส้น" className={fieldStyle} />
        <select name="selection_type" defaultValue="single" className={fieldStyle}>
          <option value="single">เลือกได้ 1 อย่าง</option>
          <option value="multiple">เลือกได้หลายอย่าง</option>
        </select>
        <label className="flex items-center gap-2 text-sm"><input name="is_required" type="checkbox" /> ต้องเลือกก่อนขาย</label>
        <div className="flex gap-2">
          <label className="flex items-center gap-1 text-xs">ขั้นต่ำ <input name="min_select" type="number" min={0} max={24} defaultValue={0} className="w-14 rounded border p-1" /></label>
          <label className="flex items-center gap-1 text-xs">สูงสุด <input name="max_select" type="number" min={1} max={24} defaultValue={1} className="w-14 rounded border p-1" /></label>
        </div>
        <button type="submit" disabled={busy} className={actionStyle + " sm:col-span-2"}>เพิ่มกลุ่มตัวเลือก</button>
      </form>

      {data?.groups.filter((g) => g.is_active).map((group) => (
        <article key={group.id} className="space-y-3 rounded-xl border border-slate-200 p-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h4 className="font-extrabold">{group.name}</h4>
              <p className="text-xs text-slate-500">
                {group.selection_type === "single" ? "เลือกอย่างเดียว" : "เลือกหลายอย่าง"}
                {" · "}{group.is_required ? "บังคับเลือก" : "ไม่บังคับ"}
                {" · "}อย่างน้อย {group.min_select} สูงสุด {group.max_select}
              </p>
            </div>
            <div className="flex gap-2">
              <button disabled={busy} className={actionStyle} onClick={() => setEditingGroup(editingGroup === group.id ? null : group.id)}>แก้กลุ่ม</button>
              <button disabled={busy} className="rounded-lg border px-2 py-1 text-xs text-red-700" onClick={() => {
                if (window.confirm("ยกเลิกการใช้งานกลุ่มตัวเลือกนี้?")) void update({ action: "deactivate_group", id: group.id }, "ปิดใช้งานกลุ่มแล้ว");
              }}>ปิดใช้</button>
            </div>
          </div>
          {editingGroup === group.id ? (
            <form onSubmit={(e) => onGroup(e, group.id)} className="grid gap-2 rounded-lg bg-slate-50 p-2 sm:grid-cols-2">
              <input name="name" required defaultValue={group.name} className={fieldStyle} />
              <select name="selection_type" defaultValue={group.selection_type} className={fieldStyle}>
                <option value="single">เลือก 1 อย่าง</option><option value="multiple">หลายอย่าง</option>
              </select>
              <label className="text-sm"><input name="is_required" type="checkbox" defaultChecked={group.is_required} /> บังคับเลือก</label>
              <div className="flex gap-2">
                <input name="min_select" type="number" min={0} max={24} defaultValue={group.min_select} className="w-16 rounded border" />
                <input name="max_select" type="number" min={1} max={24} defaultValue={group.max_select} className="w-16 rounded border" />
              </div>
              <button type="submit" disabled={busy} className={actionStyle}>บันทึกกลุ่ม</button>
            </form>
          ) : null}
          {group.options.filter((o) => o.is_active).map((option) => (
            <div key={option.id} className="space-y-2 rounded-lg bg-slate-50 p-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold">
                  {option.name} · {option.price_delta >= 0 ? "+" : ""}฿{Number(option.price_delta).toFixed(2)}
                  {option.is_default ? " · ค่าเริ่มต้น" : ""}
                </p>
                <div className="flex gap-2">
                  <button className={actionStyle} disabled={busy} onClick={() => setEditingOption(editingOption === option.id ? null : option.id)}>แก้ไข</button>
                  <button disabled={busy} className="rounded-lg border px-2 py-1 text-xs text-red-700" onClick={() => {
                    if (window.confirm("ยกเลิกตัวเลือกนี้?")) void update({ action: "deactivate_option", id: option.id }, "ปิดใช้งานตัวเลือกแล้ว");
                  }}>ปิดใช้</button>
                </div>
              </div>
              {editingOption === option.id ? (
                <form className="flex flex-wrap gap-2" onSubmit={(e) => onOption(e, group.id, option.id)}>
                  <input name="name" required defaultValue={option.name} className={fieldStyle} />
                  <input name="price_delta" type="number" step="0.01" required defaultValue={option.price_delta} className={fieldStyle + " w-28"} />
                  <label className="text-xs"><input type="checkbox" name="is_default" defaultChecked={option.is_default} /> ค่าเริ่มต้น</label>
                  <button disabled={busy} className={actionStyle}>บันทึก</button>
                </form>
              ) : null}
              {option.ingredients.length ? (
                <p className="text-xs text-slate-500">
                  หัก/คืนวัตถุดิบ: {option.ingredients.map((d) => {
                    const ingredient = data.ingredients.find((i) => i.id === d.ingredient_id);
                    return (ingredient?.name ?? d.ingredient_id) + " " + d.quantity_delta_per_item;
                  }).join(", ")}
                </p>
              ) : null}
              <form className="flex flex-wrap gap-2" onSubmit={(e) => onDelta(e, option.id)}>
                <select name="ingredient_id" defaultValue="" required className={fieldStyle}>
                  <option value="" disabled>เลือกวัตถุดิบ</option>
                  {data.ingredients.map((i) => <option key={i.id} value={i.id}>{i.name} ({i.base_unit})</option>)}
                </select>
                <input name="quantity_delta_per_item" type="number" step="0.001" required defaultValue={0}
                  title="จำนวนเพิ่ม/ลดจากสูตรต่อหนึ่งสินค้า; ใส่จำนวนติดลบเพื่อเอาวัตถุดิบออก" className={fieldStyle + " w-24"} />
                <button disabled={busy} className={actionStyle}>บันทึก ± วัตถุดิบ</button>
              </form>
            </div>
          ))}
          <form onSubmit={(e) => onOption(e, group.id)} className="flex flex-wrap gap-2 rounded-lg border border-dashed border-slate-200 p-2">
            <input name="name" required placeholder="ตัวเลือก เช่น เส้นเล็ก" className={fieldStyle} />
            <input name="price_delta" type="number" step="0.01" required defaultValue={0} className={fieldStyle + " w-28"} />
            <label className="flex items-center gap-1 text-xs"><input name="is_default" type="checkbox" /> ตั้งต้น</label>
            <button disabled={busy} type="submit" className={actionStyle}>เพิ่มตัวเลือก</button>
          </form>
        </article>
      ))}
      {data && data.groups.every((g) => !g.is_active) ? (
        <p className="p-3 text-sm text-slate-500">ยังไม่มีกลุ่มตัวเลือก กรอกชื่อและเพิ่มกลุ่มแรกได้เลย</p>
      ) : null}
      <p className="text-xs text-amber-800">
        จำนวนวัตถุดิบเป็นหน่วยพื้นฐานตามสูตร เช่น กรัม หรือชิ้น ใส่ค่าบวกเพื่อเพิ่มการใช้
        และค่าลบเพื่อลดจากสูตรเดิม การเลือกสินค้าจะถูกตรวจอีกครั้งเมื่อสร้างบิล
      </p>
    </section>
  );
}
