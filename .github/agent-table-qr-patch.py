from pathlib import Path


def read(path: str) -> str:
    return Path(path).read_text(encoding="utf-8-sig")


def write(path: str, text: str) -> None:
    Path(path).write_text(text, encoding="utf-8")


def replace_once(path: str, old: str, new: str) -> None:
    text = read(path)
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected exactly one match, found {count}\n--- needle ---\n{old[:700]}")
    write(path, text.replace(old, new, 1))


# 1) POS dine-in: closing a paid table receipt must return to the table browser for cash and transfer.
replace_once(
    "apps/backoffice-web/src/components/pos/pos-sales-module.tsx",
    '''  function closeReceiptPopup() {
    const shouldReturnToTableBrowser =
      receiptSession?.payment_method === "bank_transfer" && (orderType === "dine_in" || quickMode === "dine_in");''',
    '''  function closeReceiptPopup() {
    const shouldReturnToTableBrowser =
      Boolean(receiptSession?.table_id) &&
      (receiptSession?.order_type === "dine_in" || orderType === "dine_in" || quickMode === "dine_in");'''
)

# 2) Product edit: customer-selectable recipe flag.
edit_path = "apps/backoffice-web/src/components/pos-preview/edit-product-popup-button.tsx"
replace_once(
    edit_path,
    '''  const [useIngredientRecipe, setUseIngredientRecipe] = useState(true);
  const [ingredientLines, setIngredientLines] = useState<IngredientDraftLine[]>(
''',
    '''  const [useIngredientRecipe, setUseIngredientRecipe] = useState(true);
  const [customerIngredientSelectionEnabled, setCustomerIngredientSelectionEnabled] = useState(false);
  const [ingredientLines, setIngredientLines] = useState<IngredientDraftLine[]>(
'''
)
replace_once(
    edit_path,
    '''    setStockQuantity("0");
    setUseIngredientRecipe(true);
    setIngredientLines(
''',
    '''    setStockQuantity("0");
    setUseIngredientRecipe(true);
    setCustomerIngredientSelectionEnabled(false);
    setIngredientLines(
'''
)
replace_once(
    edit_path,
    '''      const body = (await response.json()) as ApiEnvelope<{ items: RecipeLineItem[] }>;''',
    '''      const body = (await response.json()) as ApiEnvelope<{
        items: RecipeLineItem[];
        customer_ingredient_selection_enabled?: boolean;
      }>;'''
)
replace_once(
    edit_path,
    '''      const recipeItems = body.data.items ?? [];
      const hasFallbackBridge = recipeItems.some((line) => {''',
    '''      const recipeItems = body.data.items ?? [];
      const customerSelectionEnabled = body.data.customer_ingredient_selection_enabled === true;
      const hasFallbackBridge = recipeItems.some((line) => {'''
)
replace_once(
    edit_path,
    '''      if (hasFallbackBridge) {
        setUseIngredientRecipe(false);''',
    '''      if (hasFallbackBridge) {
        setUseIngredientRecipe(false);
        setCustomerIngredientSelectionEnabled(false);'''
)
replace_once(
    edit_path,
    '''      } else {
        setUseIngredientRecipe(true);
        setStockQuantity("0");''',
    '''      } else {
        setUseIngredientRecipe(true);
        setCustomerIngredientSelectionEnabled(customerSelectionEnabled);
        setStockQuantity("0");'''
)
replace_once(
    edit_path,
    '''          use_ingredient_recipe: useIngredientRecipe,
          ingredient_lines: selectedIngredientLines''',
    '''          use_ingredient_recipe: useIngredientRecipe,
          customer_ingredient_selection_enabled: useIngredientRecipe && customerIngredientSelectionEnabled,
          ingredient_lines: selectedIngredientLines'''
)
replace_once(
    edit_path,
    '''              <label className="inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm font-bold text-slate-800">
                <input type="checkbox" checked={useIngredientRecipe} onChange={(event) => setUseIngredientRecipe(event.target.checked)} className="h-4 w-4 rounded border-slate-300" />
                <span>{th ? "เปิดโหมดสูตรวัตถุดิบ" : "Enable ingredient recipe mode"}</span>
              </label>''',
    '''              <div className="flex flex-wrap items-center gap-2">
                <label className="inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm font-bold text-slate-800">
                  <input
                    type="checkbox"
                    checked={useIngredientRecipe}
                    onChange={(event) => {
                      const checked = event.target.checked;
                      setUseIngredientRecipe(checked);
                      if (!checked) setCustomerIngredientSelectionEnabled(false);
                    }}
                    className="h-4 w-4 rounded border-slate-300"
                  />
                  <span>{th ? "เปิดโหมดสูตรวัตถุดิบ" : "Enable ingredient recipe mode"}</span>
                </label>
                <label
                  className={`inline-flex min-h-9 items-center gap-2 rounded-lg border px-3 text-sm font-bold ${
                    useIngredientRecipe
                      ? "cursor-pointer border-blue-200 bg-blue-50 text-blue-800"
                      : "cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={customerIngredientSelectionEnabled}
                    disabled={!useIngredientRecipe}
                    onChange={(event) => setCustomerIngredientSelectionEnabled(event.target.checked)}
                    className="h-4 w-4 rounded border-slate-300"
                  />
                  <span>{th ? "สำหรับลูกค้าเลือก" : "Customer selectable"}</span>
                </label>
              </div>
              {customerIngredientSelectionEnabled && useIngredientRecipe ? (
                <p className="mt-2 text-xs font-medium text-blue-700">
                  {th
                    ? "ลูกค้า Table QR จะเลือกติ๊กวัตถุดิบในสูตรได้ โดยไม่แก้ราคาและไม่แก้จำนวนสูตร"
                    : "Table QR customers may tick recipe ingredients without changing price or recipe quantities."}
                </p>
              ) : null}'''
)

# 3) Catalog API: expose + persist flag in existing recipe/update flow.
catalog_path = "apps/backoffice-web/src/app/api/backoffice/catalog/route.ts"
replace_once(
    catalog_path,
    '''  use_ingredient_recipe: boolean;
  ingredient_lines?: Array<{
    ingredient_id: string;
    quantity: number;
    quantity_unit: "gram" | "khid" | "kg" | "piece";
  }>;
};

type DeactivateProductPayload''',
    '''  use_ingredient_recipe: boolean;
  customer_ingredient_selection_enabled?: boolean;
  ingredient_lines?: Array<{
    ingredient_id: string;
    quantity: number;
    quantity_unit: "gram" | "khid" | "kg" | "piece";
  }>;
};

type DeactivateProductPayload'''
)
replace_once(
    catalog_path,
    '''      return ok({
        view: "recipes",
        items: data ?? [],
        pagination: buildPaginationMeta(page, pageSize, count)
      });''',
    '''      const { data: productSettings, error: productSettingsError } = await supabase
        .from("products")
        .select("customer_ingredient_selection_enabled")
        .eq("tenant_id", auth.tenantId!)
        .eq("branch_id", scopedBranchId)
        .eq("id", productId)
        .maybeSingle<{ customer_ingredient_selection_enabled: boolean | null }>();
      if (productSettingsError) {
        return fail("recipe_product_settings_query_failed", productSettingsError.message, 500);
      }

      return ok({
        view: "recipes",
        items: data ?? [],
        customer_ingredient_selection_enabled: productSettings?.customer_ingredient_selection_enabled === true,
        pagination: buildPaginationMeta(page, pageSize, count)
      });'''
)
replace_once(
    catalog_path,
    '''      const useIngredientRecipe = Boolean(body.use_ingredient_recipe);
      const ingredientLines = Array.isArray(body.ingredient_lines) ? body.ingredient_lines : [];''',
    '''      const useIngredientRecipe = Boolean(body.use_ingredient_recipe);
      const customerIngredientSelectionEnabled =
        useIngredientRecipe && Boolean(body.customer_ingredient_selection_enabled);
      const ingredientLines = Array.isArray(body.ingredient_lines) ? body.ingredient_lines : [];'''
)
replace_once(
    catalog_path,
    '''      let updateProductError: PostgrestLikeError | null = null;
      for (let i = 0; i < updatePayloadCandidates.length; i += 1) {
        const result = await supabase
          .from("products")
          .update(updatePayloadCandidates[i])''',
    '''      const updatePayloadCandidatesWithCustomerSelection = updatePayloadCandidates.map((candidate) => ({
        ...candidate,
        customer_ingredient_selection_enabled: customerIngredientSelectionEnabled
      }));

      let updateProductError: PostgrestLikeError | null = null;
      for (let i = 0; i < updatePayloadCandidatesWithCustomerSelection.length; i += 1) {
        const result = await supabase
          .from("products")
          .update(updatePayloadCandidatesWithCustomerSelection[i])'''
)

# 4) Table QR server menu: add selectable recipe ingredient options.
qr_lib_path = "apps/backoffice-web/src/lib/table-qr-ordering.ts"
replace_once(
    qr_lib_path,
    '''type TableQrMenuProduct = {
  id: string;
  name: string;
  category: string;
  price: number;
};''',
    '''type TableQrCustomerIngredientOption = {
  ingredient_id: string;
  name: string;
};

type TableQrMenuProduct = {
  id: string;
  name: string;
  category: string;
  price: number;
  customer_ingredient_selection_enabled: boolean;
  customer_ingredient_options: TableQrCustomerIngredientOption[];
};'''
)
replace_once(
    qr_lib_path,
    '''type TableQrProductRow = {
  id: string;
  name: string;
  price: number;
  is_active?: boolean;
};''',
    '''type TableQrProductRow = {
  id: string;
  name: string;
  price: number;
  is_active?: boolean;
};

type TableQrRecipeChoiceRow = {
  product_id: string;
  ingredient_id: string;
  ingredients: { name?: string | null } | Array<{ name?: string | null }> | null;
};'''
)
replace_once(
    qr_lib_path,
    '''    .select("id,name,category,price,is_active")''',
    '''    .select("id,name,category,price,is_active,customer_ingredient_selection_enabled")'''
)
replace_once(
    qr_lib_path,
    '''  if (error) throw new Error(error.message);

  const products = (data ?? []).map((row) => ({
    id: String(row.id),
    name: String(row.name ?? ""),
    category: String(row.category ?? "เมนู"),
    price: Number(row.price ?? 0)
  }));''',
    '''  if (error) throw new Error(error.message);

  const selectableProductIds = (data ?? [])
    .filter((row) => row.customer_ingredient_selection_enabled === true)
    .map((row) => String(row.id));
  const customerIngredientOptionsByProduct = new Map<string, TableQrCustomerIngredientOption[]>();

  if (selectableProductIds.length > 0) {
    const { data: recipeRows, error: recipeError } = await supabase
      .from("recipes")
      .select("product_id,ingredient_id,ingredients(name)")
      .eq("tenant_id", context.tenant_id)
      .eq("branch_id", context.branch_id)
      .eq("applies_when_takeaway_only", false)
      .in("product_id", selectableProductIds);
    if (recipeError) throw new Error(recipeError.message);

    for (const row of (recipeRows ?? []) as TableQrRecipeChoiceRow[]) {
      const productId = String(row.product_id ?? "").trim();
      const ingredientId = String(row.ingredient_id ?? "").trim();
      const ingredientRecord = Array.isArray(row.ingredients) ? row.ingredients[0] : row.ingredients;
      const name = String(ingredientRecord?.name ?? "").trim();
      if (!productId || !ingredientId || !name || name.startsWith("STOCK:")) continue;
      const current = customerIngredientOptionsByProduct.get(productId) ?? [];
      current.push({ ingredient_id: ingredientId, name });
      customerIngredientOptionsByProduct.set(productId, current);
    }
  }

  const products = (data ?? []).map((row) => {
    const productId = String(row.id);
    const customerSelectable = row.customer_ingredient_selection_enabled === true;
    return {
      id: productId,
      name: String(row.name ?? ""),
      category: String(row.category ?? "เมนู"),
      price: Number(row.price ?? 0),
      customer_ingredient_selection_enabled: customerSelectable,
      customer_ingredient_options: customerSelectable ? customerIngredientOptionsByProduct.get(productId) ?? [] : []
    };
  });'''
)

# 5) Table QR mobile: hide submitted history, transient toasts, checkbox-only ingredient picker.
mobile_path = "apps/backoffice-web/src/components/table-order/table-order-mobile.tsx"
replace_once(
    mobile_path,
    '''type MenuProduct = {
  id: string;
  name: string;
  category: string;
  price: number;
  image_url?: string | null;''',
    '''type CustomerIngredientOption = {
  ingredient_id: string;
  name: string;
};

type MenuProduct = {
  id: string;
  name: string;
  category: string;
  price: number;
  customer_ingredient_selection_enabled?: boolean;
  customer_ingredient_options?: CustomerIngredientOption[];
  image_url?: string | null;'''
)
replace_once(mobile_path, 'type SubmitItem = { product_id: string; quantity: number };', 'type SubmitItem = { product_id: string; quantity: number; note?: string | null };')
replace_once(
    mobile_path,
    '''function buildSubmitItems(cartItems: Array<MenuProduct & { quantity: number }>): SubmitItem[] {
  return cartItems
    .map((item) => ({ product_id: String(item.id ?? "").trim(), quantity: Number(item.quantity) }))
    .filter((item) => item.product_id && Number.isFinite(item.quantity) && item.quantity > 0)
    .map((item) => ({ product_id: item.product_id, quantity: Math.max(1, Math.min(99, Math.trunc(item.quantity))) }));
}''',
    '''function buildCustomerIngredientNote(product: MenuProduct, selectedIngredientIds: string[] | undefined) {
  if (!product.customer_ingredient_selection_enabled || !selectedIngredientIds?.length) return null;
  const selected = new Set(selectedIngredientIds);
  const names = (product.customer_ingredient_options ?? [])
    .filter((option) => selected.has(option.ingredient_id))
    .map((option) => option.name.trim())
    .filter(Boolean);
  if (!names.length) return null;
  return `ลูกค้าเลือก: ${names.join(", ")}`.slice(0, 240);
}

function buildSubmitItems(
  cartItems: Array<MenuProduct & { quantity: number }>,
  customerIngredientChoices: Record<string, string[]>
): SubmitItem[] {
  return cartItems
    .map((item) => ({
      product_id: String(item.id ?? "").trim(),
      quantity: Number(item.quantity),
      note: buildCustomerIngredientNote(item, customerIngredientChoices[item.id])
    }))
    .filter((item) => item.product_id && Number.isFinite(item.quantity) && item.quantity > 0)
    .map((item) => ({
      product_id: item.product_id,
      quantity: Math.max(1, Math.min(99, Math.trunc(item.quantity))),
      note: item.note
    }));
}'''
)
replace_once(
    mobile_path,
    '''  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [linkClosed, setLinkClosed] = useState(false);''',
    '''  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [submittedOpen, setSubmittedOpen] = useState(false);
  const [ingredientPickerProduct, setIngredientPickerProduct] = useState<MenuProduct | null>(null);
  const [ingredientPickerSelection, setIngredientPickerSelection] = useState<string[]>([]);
  const [customerIngredientChoices, setCustomerIngredientChoices] = useState<Record<string, string[]>>({});
  const [linkClosed, setLinkClosed] = useState(false);'''
)
replace_once(
    mobile_path,
    '''  function removeItem(productId: string) {
    if (submitting || serviceSubmitting) return;
    setCart((current) => { const next = { ...current }; delete next[productId]; return next; });
  }''',
    '''  function addProduct(product: MenuProduct) {
    if (submitting || serviceSubmitting || !canOrder) return;
    const options = product.customer_ingredient_options ?? [];
    if (product.customer_ingredient_selection_enabled && options.length > 0 && (cart[product.id] ?? 0) === 0) {
      setIngredientPickerProduct(product);
      setIngredientPickerSelection(customerIngredientChoices[product.id] ?? []);
      return;
    }
    changeQuantity(product.id, 1);
  }

  function closeIngredientPicker() {
    setIngredientPickerProduct(null);
    setIngredientPickerSelection([]);
  }

  function confirmIngredientPicker() {
    if (!ingredientPickerProduct) return;
    const productId = ingredientPickerProduct.id;
    setCustomerIngredientChoices((current) => ({ ...current, [productId]: ingredientPickerSelection }));
    closeIngredientPicker();
    changeQuantity(productId, 1);
  }

  function removeItem(productId: string) {
    if (submitting || serviceSubmitting) return;
    setCart((current) => { const next = { ...current }; delete next[productId]; return next; });
    setCustomerIngredientChoices((current) => {
      const next = { ...current };
      delete next[productId];
      return next;
    });
  }'''
)
replace_once(
    mobile_path,
    '''    const items = buildSubmitItems(cartItems);
    if (!items.length) return setError("กรุณาเลือกจำนวนอาหารอย่างน้อย 1 รายการ");''',
    '''    const items = buildSubmitItems(cartItems, customerIngredientChoices);
    if (!items.length) {
      setToast({ kind: "warning", title: "ยังไม่มีรายการอาหาร", detail: "กรุณาเลือกอาหารอย่างน้อย 1 รายการ" });
      return;
    }'''
)
replace_once(
    mobile_path,
    '''      setCart({});
      setCartOpen(false);
      setToast({ kind: "success", title: "ส่งรายการเข้าครัวแล้ว", detail: `เลขบิล ${orderNo} · หากต้องการแก้ไขรายการที่ส่งแล้ว กรุณาเรียกพนักงาน` });''',
    '''      setCart({});
      setCustomerIngredientChoices({});
      setCartOpen(false);
      setToast({ kind: "success", title: "ส่งรายการเข้าครัวแล้ว", detail: `เลขบิล ${orderNo} · หากต้องการแก้ไขรายการที่ส่งแล้ว กรุณาเรียกพนักงาน` });'''
)
replace_once(
    mobile_path,
    '''    } catch (submitError) {
      if ((submitError as { name?: string }).name === "AbortError") setError("ส่งรายการไม่สำเร็จ เนื่องจากระบบใช้เวลานานเกินไป กรุณาลองใหม่");
      else setError(submitError instanceof Error ? submitError.message : "ส่งรายการไม่สำเร็จ");
    } finally { setSubmitting(false); }''',
    '''    } catch (submitError) {
      const detail =
        (submitError as { name?: string }).name === "AbortError"
          ? "ระบบใช้เวลานานเกินไป กรุณาลองใหม่"
          : submitError instanceof Error
            ? submitError.message
            : "กรุณาลองใหม่";
      setError(null);
      setToast({ kind: "error", title: "ส่งรายการไม่สำเร็จ", detail });
    } finally { setSubmitting(false); }'''
)
replace_once(
    mobile_path,
    '''    } catch (submitError) {
      if ((submitError as { name?: string }).name === "AbortError") setError("ส่งคำขอไม่สำเร็จ ระบบใช้เวลานานเกินไป");
      else setError(submitError instanceof Error ? submitError.message : "ส่งคำขอไม่สำเร็จ");
    } finally { setServiceSubmitting(null); }''',
    '''    } catch (submitError) {
      const detail =
        (submitError as { name?: string }).name === "AbortError"
          ? "ระบบใช้เวลานานเกินไป กรุณาลองใหม่"
          : submitError instanceof Error
            ? submitError.message
            : "กรุณาลองใหม่";
      setError(null);
      setToast({ kind: "error", title: "ส่งคำขอไม่สำเร็จ", detail });
    } finally { setServiceSubmitting(null); }'''
)
replace_once(
    mobile_path,
    '''        <span className={styles.tableBadge}>{menu.table_code}</span>''',
    '''        {submittedItems.length > 0 ? (
          <button
            type="button"
            className={styles.submittedHistoryButton}
            onClick={() => setSubmittedOpen(true)}
            aria-label={`ดูรายการที่ส่งแล้ว ${menu.submitted_summary?.item_count ?? 0} รายการ`}
            title="ดูรายการที่ส่งแล้ว"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M6 2h12v20l-3-2-3 2-3-2-3 2V2Z" />
              <path d="M9 7h6M9 11h6M9 15h4" />
            </svg>
            <span>{menu.submitted_summary?.item_count ?? 0}</span>
          </button>
        ) : null}
        <span className={styles.tableBadge}>{menu.table_code}</span>'''
)
replace_once(
    mobile_path,
    '''      {submittedItems.length > 0 ? (
        <section className={styles.submittedSummary} aria-label="รายการที่ส่งแล้ว">
          <div className={styles.submittedSummaryHead}><div><strong>รายการที่ส่งแล้ว</strong><span> {menu.submitted_summary?.item_count ?? 0} รายการ</span></div><strong>{money(menu.submitted_summary?.total_amount ?? 0)}</strong></div>
          <div className={styles.submittedRows}>{submittedItems.map((item, index) => <div className={styles.submittedRow} key={`${item.product_id}-${index}`}><span>{item.name} × {item.quantity}</span><strong>{money(item.line_total)}</strong></div>)}</div>
          <p className={styles.submittedLockedNote}>รายการที่ยืนยันแล้วแก้ไขหรือลบจากมือถือไม่ได้ หากต้องการแก้ไขกรุณาเรียกพนักงาน</p>
        </section>
      ) : null}
''',
    ''
)
replace_once(
    mobile_path,
    '''            <button type="button" className={styles.productPickButton} onClick={() => changeQuantity(product.id, 1)} disabled={submitting || Boolean(serviceSubmitting) || !canOrder || !available} aria-label={available ? `เพิ่ม ${product.name} ลงตะกร้า` : `${product.name} สต๊อกไม่เพียงพอ`}>''',
    '''            <button type="button" className={styles.productPickButton} onClick={() => addProduct(product)} disabled={submitting || Boolean(serviceSubmitting) || !canOrder || !available} aria-label={available ? `เพิ่ม ${product.name} ลงตะกร้า` : `${product.name} สต๊อกไม่เพียงพอ`}>'''
)
replace_once(
    mobile_path,
    '''              <button type="button" onClick={() => changeQuantity(product.id, 1)} disabled={submitting || Boolean(serviceSubmitting) || !canOrder || !available || quantity >= productMaxQuantity(product)}>+</button>''',
    '''              <button type="button" onClick={() => addProduct(product)} disabled={submitting || Boolean(serviceSubmitting) || !canOrder || !available || quantity >= productMaxQuantity(product)}>+</button>'''
)
replace_once(
    mobile_path,
    '''      {submitting ? <div className={styles.processing}>''',
    '''      {submittedOpen ? (
        <div className={styles.submittedModalBackdrop} role="presentation" onMouseDown={() => setSubmittedOpen(false)}>
          <section className={styles.submittedModal} role="dialog" aria-modal="true" aria-label="รายการที่ส่งแล้ว" onMouseDown={(event) => event.stopPropagation()}>
            <header className={styles.submittedModalHead}>
              <div><strong>รายการที่ส่งแล้ว</strong><span>{menu.submitted_summary?.item_count ?? 0} รายการ</span></div>
              <button type="button" onClick={() => setSubmittedOpen(false)} aria-label="ปิด">×</button>
            </header>
            <div className={styles.submittedModalRows}>
              {submittedItems.map((item, index) => (
                <div className={styles.submittedModalRow} key={`${item.product_id}-${index}`}>
                  <span>{item.name} × {item.quantity}</span><strong>{money(item.line_total)}</strong>
                </div>
              ))}
            </div>
            <footer className={styles.submittedModalFooter}>
              <div><span>รวมรายการที่ส่งแล้ว</span><strong>{money(menu.submitted_summary?.total_amount ?? 0)}</strong></div>
              <p>รายการที่ยืนยันแล้วแก้ไขหรือลบจากมือถือไม่ได้ หากต้องการแก้ไขกรุณาเรียกพนักงาน</p>
              <button type="button" onClick={() => setSubmittedOpen(false)}>ปิด</button>
            </footer>
          </section>
        </div>
      ) : null}

      {ingredientPickerProduct ? (
        <div className={styles.ingredientPickerBackdrop} role="presentation" onMouseDown={closeIngredientPicker}>
          <section className={styles.ingredientPicker} role="dialog" aria-modal="true" aria-label={`เลือกวัตถุดิบ ${ingredientPickerProduct.name}`} onMouseDown={(event) => event.stopPropagation()}>
            <header className={styles.ingredientPickerHead}>
              <div><strong>เลือกวัตถุดิบ</strong><span>{ingredientPickerProduct.name}</span></div>
              <button type="button" onClick={closeIngredientPicker} aria-label="ปิด">×</button>
            </header>
            <p className={styles.ingredientPickerHint}>เลือกได้ตามต้องการ · ไม่มีการเพิ่มราคาและไม่มีการแก้จำนวนสูตร</p>
            <div className={styles.ingredientPickerOptions}>
              {(ingredientPickerProduct.customer_ingredient_options ?? []).map((option) => {
                const checked = ingredientPickerSelection.includes(option.ingredient_id);
                return (
                  <label className={checked ? styles.ingredientPickerOptionSelected : styles.ingredientPickerOption} key={option.ingredient_id}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(event) => {
                        setIngredientPickerSelection((current) =>
                          event.target.checked
                            ? Array.from(new Set([...current, option.ingredient_id]))
                            : current.filter((id) => id !== option.ingredient_id)
                        );
                      }}
                    />
                    <span>{option.name}</span>
                  </label>
                );
              })}
            </div>
            <footer className={styles.ingredientPickerFooter}>
              <button type="button" onClick={closeIngredientPicker}>ยกเลิก</button>
              <button type="button" className={styles.ingredientPickerConfirm} onClick={confirmIngredientPicker}>เพิ่มลงตะกร้า</button>
            </footer>
          </section>
        </div>
      ) : null}

      {submitting ? <div className={styles.processing}>'''
)

# 6) Table QR styles.
css_path = "apps/backoffice-web/src/components/table-order/table-order-mobile.module.css"
replace_once(
    css_path,
    '''.hero > div:first-child {
  min-width: 0;
  max-width: calc(100% - 82px);
}''',
    '''.hero > div:first-child {
  min-width: 0;
  max-width: calc(100% - 138px);
}'''
)
replace_once(
    css_path,
    '''.tableBadge::before {
  content: "โต๊ะ ";
  margin-right: 4px;
  color: #4f89bf;
  font-size: 13px;
  font-weight: 800;
}

.cartSheet''',
    '''.tableBadge::before {
  content: "โต๊ะ ";
  margin-right: 4px;
  color: #4f89bf;
  font-size: 13px;
  font-weight: 800;
}

.submittedHistoryButton {
  position: absolute;
  right: 96px;
  bottom: 18px;
  display: inline-flex;
  min-width: 44px;
  min-height: 38px;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 0 9px;
  border: 1px solid #b8d8f6;
  border-radius: 999px;
  background: #f6fbff;
  color: #0871d7;
  font-weight: 900;
  box-shadow: 0 4px 12px rgba(8, 113, 215, 0.08);
  cursor: pointer;
  touch-action: manipulation;
}
.submittedHistoryButton span { min-width: 16px; font-size: 12px; text-align: center; }
.submittedHistoryButton:active { transform: translateY(1px); }

.cartSheet'''
)
replace_once(
    css_path,
    '''.submittedSummary { display: grid; gap: 8px; margin: 8px 10px 10px; padding: 12px; border: 1px solid #bdd9f2; border-radius: 12px; background: #f6fbff; }
.submittedSummaryHead, .submittedRow { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.submittedSummaryHead span { color:#64748b; font-size:12px; }
.submittedSummaryHead strong { color:#0875df; font-size:16px; }
.submittedRows { display: grid; gap: 6px; }
.submittedRow { padding-top: 6px; border-top: 1px solid #dbeafe; font-size:13px; }
.submittedLockedNote { margin:0; color:#64748b; font-size:12px; }''',
    '''.submittedModalBackdrop, .ingredientPickerBackdrop { position: fixed; inset: 0; z-index: 26; display: grid; align-items: end; padding: 18px 9px 0; background: rgba(3, 24, 47, 0.61); backdrop-filter: blur(4px); }
.submittedModal, .ingredientPicker { width: min(100%, 660px); max-height: min(78dvh, 720px); margin: 0 auto; overflow: hidden; border: 1px solid rgba(218, 228, 238, 0.95); border-radius: 22px 22px 0 0; background: #fff; box-shadow: 0 -18px 42px rgba(2, 31, 61, 0.24); animation: cartUp 0.2s ease-out; }
.submittedModalHead, .ingredientPickerHead { display: flex; min-height: 66px; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 15px; border-bottom: 1px solid #e0e8ef; }
.submittedModalHead > div, .ingredientPickerHead > div { display: grid; gap: 2px; }
.submittedModalHead strong, .ingredientPickerHead strong { font-size: 17px; }
.submittedModalHead span, .ingredientPickerHead span { color: #71869a; font-size: 12px; }
.submittedModalHead > button, .ingredientPickerHead > button { width: 38px; height: 38px; border: 1px solid #d4dee8; border-radius: 50%; background: #f7f9fb; color: #45627e; font-size: 24px; cursor: pointer; }
.submittedModalRows { max-height: 45vh; overflow-y: auto; padding: 4px 15px; }
.submittedModalRow { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 0; border-bottom: 1px solid #e7edf3; font-size: 14px; }
.submittedModalRow strong { color: #0875df; white-space: nowrap; }
.submittedModalFooter { display: grid; gap: 9px; padding: 12px 15px calc(12px + env(safe-area-inset-bottom)); border-top: 1px solid #dce6ef; background: #f8fafc; }
.submittedModalFooter > div { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.submittedModalFooter > div strong { color: #0875df; font-size: 18px; }
.submittedModalFooter p { margin: 0; color: #64748b; font-size: 12px; line-height: 1.45; }
.submittedModalFooter button { min-height: 44px; border: 0; border-radius: 12px; background: #087df0; color: #fff; font-weight: 900; cursor: pointer; }
.ingredientPickerHint { margin: 0; padding: 11px 15px 0; color: #64748b; font-size: 12px; line-height: 1.45; }
.ingredientPickerOptions { display: grid; max-height: 48vh; gap: 8px; overflow-y: auto; padding: 12px 15px; }
.ingredientPickerOption, .ingredientPickerOptionSelected { display: flex; min-height: 46px; align-items: center; gap: 10px; padding: 9px 12px; border: 1px solid #dbe4ee; border-radius: 12px; background: #fff; color: #263547; font-size: 14px; font-weight: 800; cursor: pointer; }
.ingredientPickerOptionSelected { border-color: #82bff4; background: #eef7ff; color: #075fae; }
.ingredientPickerOption input, .ingredientPickerOptionSelected input { width: 18px; height: 18px; accent-color: #087df0; }
.ingredientPickerFooter { display: grid; grid-template-columns: 1fr 1.35fr; gap: 9px; padding: 12px 15px calc(12px + env(safe-area-inset-bottom)); border-top: 1px solid #dce6ef; background: #f8fafc; }
.ingredientPickerFooter button { min-height: 46px; border: 1px solid #cbd8e5; border-radius: 12px; background: #fff; color: #52687d; font-weight: 900; cursor: pointer; }
.ingredientPickerFooter .ingredientPickerConfirm { border-color: #087df0; background: #087df0; color: #fff; }'''
)
replace_once(
    css_path,
    '''  .tableBadge { right: 12px; bottom: 16px; min-width: 64px; min-height: 35px; }''',
    '''  .tableBadge { right: 12px; bottom: 16px; min-width: 64px; min-height: 35px; }
  .submittedHistoryButton { right: 84px; bottom: 16px; min-width: 40px; min-height: 35px; padding-inline: 7px; }'''
)

# 7) Migration source of truth.
migration = Path("supabase/migrations/20260811143000_table_qr_customer_ingredient_selection.sql")
migration.write_text(
    """alter table public.products
  add column if not exists customer_ingredient_selection_enabled boolean not null default false;

comment on column public.products.customer_ingredient_selection_enabled is
  'When true, Table QR customers may select recipe ingredients as order preferences. This flag does not change catalog price or recipe quantities.';
""",
    encoding="utf-8",
)

# 8) Handoff docs.
doc_note = """

## 2026-08-11 — Dine-in payment return + Table QR customer recipe choices

- Fixed dine-in receipt close behavior: after a paid table receipt is closed (cash or bank transfer), POS returns to the table browser instead of staying inside the settled table.
- Table QR submitted-order history is hidden from normal menu flow and opened from a receipt icon beside the table badge.
- Table QR action success/failure notifications use transient toast messages; fatal QR/menu load failures remain inline.
- Product edit now has `สำหรับลูกค้าเลือก` / `Customer selectable` beside ingredient recipe mode.
- When enabled, Table QR opens a checkbox-only recipe ingredient picker. Customer selections do not change product price or recipe quantities and are persisted as the order-item note for downstream kitchen/printing work.
- Added `products.customer_ingredient_selection_enabled` migration; default is `false`.
- Scope intentionally excludes Kitchen PR #47 and printer logic.
"""
for doc in ["README.md", "context.md"]:
    text = read(doc)
    if "## 2026-08-11 — Dine-in payment return + Table QR customer recipe choices" not in text:
        write(doc, text.rstrip() + doc_note + "\n")
