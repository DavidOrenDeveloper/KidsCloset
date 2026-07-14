/* =========================================================
   ארון הילדים - אפליקציית מעקב בגדים
   כל הנתונים נשמרים מקומית: localStorage (מידע) + IndexedDB (תמונות)
   ========================================================= */

(() => {
  "use strict";

  /* ---------- Constants / keys ---------- */
  const LS_CHILDREN = "kc_children";
  const LS_CATEGORIES = "kc_categories";
  const LS_ITEMS = "kc_items";
  const IDB_NAME = "kidsClosetDB";
  const IDB_STORE = "images";
  const IDB_VERSION = 1;

  /* ---------- Utilities ---------- */
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : "id-" + Date.now() + "-" + Math.random().toString(16).slice(2));
  const $ = (sel) => document.querySelector(sel);
  const $all = (sel) => Array.from(document.querySelectorAll(sel));

  function toast(msg, ms = 2200) {
    const el = $("#toast");
    el.textContent = msg;
    el.classList.remove("hidden");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.add("hidden"), ms);
  }

  function confirmDialog(message) {
    return new Promise((resolve) => {
      const overlay = $("#confirmOverlay");
      const dialog = $("#confirmDialog");
      $("#confirmMessage").textContent = message;
      overlay.classList.remove("hidden");
      dialog.classList.remove("hidden");
      const cleanup = (result) => {
        overlay.classList.add("hidden");
        dialog.classList.add("hidden");
        okBtn.removeEventListener("click", onOk);
        cancelBtn.removeEventListener("click", onCancel);
        overlay.removeEventListener("click", onCancel);
        resolve(result);
      };
      const okBtn = $("#confirmOk");
      const cancelBtn = $("#confirmCancel");
      const onOk = () => cleanup(true);
      const onCancel = () => cleanup(false);
      okBtn.addEventListener("click", onOk);
      cancelBtn.addEventListener("click", onCancel);
      overlay.addEventListener("click", onCancel);
    });
  }

  /* ---------- localStorage data layer ---------- */
  function readLS(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      console.error("שגיאת קריאה מ-localStorage", key, e);
      return fallback;
    }
  }
  function writeLS(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      console.error("שגיאת כתיבה ל-localStorage", key, e);
      toast("שגיאה בשמירת הנתונים. יתכן שהאחסון מלא.");
    }
  }

  const getChildren = () => readLS(LS_CHILDREN, []);
  const setChildren = (v) => writeLS(LS_CHILDREN, v);
  const getCategories = () => readLS(LS_CATEGORIES, []);
  const setCategories = (v) => writeLS(LS_CATEGORIES, v);
  const getItems = () => readLS(LS_ITEMS, []);
  const setItems = (v) => writeLS(LS_ITEMS, v);

  /* ---------- IndexedDB layer (images) ---------- */
  let dbPromise = null;
  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(IDB_NAME, IDB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE, { keyPath: "id" });
        }
      };
      req.onsuccess = (e) => resolve(e.target.result);
      req.onerror = (e) => reject(e.target.error);
    });
    return dbPromise;
  }

  async function idbPut(id, dataUrl) {
    try {
      const db = await openDB();
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, "readwrite");
        tx.objectStore(IDB_STORE).put({ id, dataUrl });
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => reject(tx.error);
      });
    } catch (e) {
      console.error("idbPut failed", e);
      toast("שגיאה בשמירת התמונה");
      return false;
    }
  }

  async function idbGet(id) {
    if (!id) return null;
    try {
      const db = await openDB();
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, "readonly");
        const req = tx.objectStore(IDB_STORE).get(id);
        req.onsuccess = () => resolve(req.result ? req.result.dataUrl : null);
        req.onerror = () => reject(req.error);
      });
    } catch (e) {
      console.error("idbGet failed", e);
      return null;
    }
  }

  async function idbDelete(id) {
    if (!id) return;
    try {
      const db = await openDB();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, "readwrite");
        tx.objectStore(IDB_STORE).delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch (e) {
      console.error("idbDelete failed", e);
    }
  }

  async function idbGetAll() {
    try {
      const db = await openDB();
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, "readonly");
        const req = tx.objectStore(IDB_STORE).getAll();
        req.onsuccess = () => {
          const map = {};
          (req.result || []).forEach((row) => (map[row.id] = row.dataUrl));
          resolve(map);
        };
        req.onerror = () => reject(req.error);
      });
    } catch (e) {
      console.error("idbGetAll failed", e);
      return {};
    }
  }

  /* ---------- Image compression via Canvas ---------- */
  function compressImage(file, maxDim = 800, quality = 0.62) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("קריאת הקובץ נכשלה"));
      reader.onload = () => {
        img.onload = () => {
          try {
            let { width, height } = img;
            if (width > height && width > maxDim) {
              height = Math.round((height * maxDim) / width);
              width = maxDim;
            } else if (height >= width && height > maxDim) {
              width = Math.round((width * maxDim) / height);
              height = maxDim;
            }
            const canvas = document.createElement("canvas");
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext("2d");
            ctx.fillStyle = "#FFFFFF";
            ctx.fillRect(0, 0, width, height);
            ctx.drawImage(img, 0, 0, width, height);
            resolve(canvas.toDataURL("image/jpeg", quality));
          } catch (err) {
            reject(err);
          }
        };
        img.onerror = () => reject(new Error("טעינת התמונה נכשלה"));
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  /* ---------- State ---------- */
  let currentPhotoDataUrl = null; // holds newly picked/compressed photo for the open item form
  let photoRemoved = false;

  /* ---------- Rendering: dropdowns ---------- */
  function fillSelectOptions(select, list, placeholder, keepValue) {
    const prev = keepValue !== undefined ? keepValue : select.value;
    select.innerHTML = "";
    if (placeholder !== null) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = placeholder;
      select.appendChild(opt);
    }
    list.forEach((entry) => {
      const opt = document.createElement("option");
      opt.value = entry.id;
      opt.textContent = entry.name;
      select.appendChild(opt);
    });
    if (prev && list.some((e) => e.id === prev)) select.value = prev;
  }

  function refreshDropdowns() {
    const children = getChildren();
    const categories = getCategories();
    fillSelectOptions($("#filterChild"), children, "כל הילדים");
    fillSelectOptions($("#filterCategory"), categories, "כל הקטגוריות");
    fillSelectOptions($("#itemChild"), children, null);
    fillSelectOptions($("#itemCategory"), categories, null);
  }

  /* ---------- Rendering: items grid ---------- */
  async function renderItems() {
    const items = getItems();
    const children = getChildren();
    const categories = getCategories();
    const childMap = Object.fromEntries(children.map((c) => [c.id, c.name]));
    const catMap = Object.fromEntries(categories.map((c) => [c.id, c.name]));

    const fChild = $("#filterChild").value;
    const fCat = $("#filterCategory").value;
    const fSeason = $("#filterSeason").value;
    const fStatus = $("#filterStatus").value;
    const fSearch = $("#filterSearch").value.trim().toLowerCase();

    const filtered = items.filter((it) => {
      if (fChild && it.childId !== fChild) return false;
      if (fCat && it.categoryId !== fCat) return false;
      if (fSeason && it.season !== fSeason) return false;
      if (fStatus && it.status !== fStatus) return false;
      if (fSearch) {
        const hay = [
          it.color, it.size, it.note,
          childMap[it.childId], catMap[it.categoryId], it.status, it.season
        ].filter(Boolean).join(" ").toLowerCase();
        if (!hay.includes(fSearch)) return false;
      }
      return true;
    });

    filtered.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    const grid = $("#itemsGrid");
    grid.innerHTML = "";

    $("#emptyState").classList.toggle("hidden", items.length > 0);

    const totalPrice = filtered.reduce((sum, it) => sum + (Number(it.price) || 0), 0);
    $("#summaryBar").innerHTML = items.length
      ? `מציג <b>${filtered.length}</b> מתוך <b>${items.length}</b> פריטים &middot; סה"כ מוצג: <b>${totalPrice.toFixed(0)} ₪</b>`
      : "";

    if (!items.length) return;

    if (!filtered.length) {
      grid.innerHTML = `<p style="grid-column:1/-1; text-align:center; color:var(--ink-soft); padding:30px 10px;">לא נמצאו פריטים התואמים את הסינון.</p>`;
      return;
    }

    // Render cards, fetch images progressively
    for (const it of filtered) {
      const card = document.createElement("div");
      card.className = "item-card";
      card.dataset.id = it.id;

      const statusClass = it.status === "בשימוש כרגע" ? "in-use" : (it.status === "נמכר / נתרם" ? "sold" : "");

      card.innerHTML = `
        <div class="item-photo-slot"></div>
        <div class="item-info">
          <div class="item-child-cat">${escapeHtml(childMap[it.childId] || "ללא שיוך")} &middot; ${escapeHtml(catMap[it.categoryId] || "ללא קטגוריה")}</div>
          <div class="item-meta">${escapeHtml(it.season || "")}${it.size ? " · מידה " + escapeHtml(it.size) : ""}${it.color ? " · " + escapeHtml(it.color) : ""}</div>
          <div class="item-bottom-row">
            <span class="item-status ${statusClass}">${escapeHtml(it.status || "")}</span>
            <span class="item-price mono">${it.price ? Number(it.price).toFixed(0) + " ₪" : "—"}</span>
          </div>
        </div>
      `;
      card.addEventListener("click", () => openItemModal(it.id));
      grid.appendChild(card);

      const photoSlot = card.querySelector(".item-photo-slot");
      if (it.imageId) {
        photoSlot.innerHTML = `<div class="item-photo-placeholder">⏳</div>`;
        idbGet(it.imageId).then((dataUrl) => {
          photoSlot.innerHTML = dataUrl
            ? `<img class="item-photo" src="${dataUrl}" alt="" />`
            : `<div class="item-photo-placeholder">🧥</div>`;
        });
      } else {
        photoSlot.innerHTML = `<div class="item-photo-placeholder">🧥</div>`;
      }
    }
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }

  /* ---------- Item modal (add/edit) ---------- */
  function openItemModal(itemId) {
    const children = getChildren();
    const categories = getCategories();

    if (!itemId && (children.length === 0 || categories.length === 0)) {
      toast("יש להוסיף קודם ילד/ה וקטגוריה אחת לפחות (מהתפריט ☰)");
      return;
    }

    refreshDropdowns();
    currentPhotoDataUrl = null;
    photoRemoved = false;

    const form = $("#itemForm");
    form.reset();
    $("#itemId").value = itemId || "";
    $("#photoPreview").classList.add("hidden");
    $("#photoPlaceholder").classList.remove("hidden");
    $("#btnRemovePhoto").classList.add("hidden");
    $("#btnDeleteItem").classList.toggle("hidden", !itemId);

    if (itemId) {
      const item = getItems().find((i) => i.id === itemId);
      if (!item) { toast("הפריט לא נמצא"); return; }
      $("#itemModalTitle").textContent = "עריכת פריט";
      $("#itemChild").value = item.childId || "";
      $("#itemCategory").value = item.categoryId || "";
      $("#itemSize").value = item.size || "";
      $("#itemColor").value = item.color || "";
      $("#itemSeason").value = item.season || "קיץ";
      $("#itemStatus").value = item.status || "בשימוש כרגע";
      $("#itemPrice").value = item.price || "";
      $("#itemNote").value = item.note || "";
      if (item.imageId) {
        $("#photoPreview").classList.remove("hidden");
        $("#photoPlaceholder").classList.add("hidden");
        $("#btnRemovePhoto").classList.remove("hidden");
        $("#photoPreview").src = "";
        idbGet(item.imageId).then((url) => { if (url) $("#photoPreview").src = url; });
      }
    } else {
      $("#itemModalTitle").textContent = "פריט חדש";
      $("#itemSeason").value = "קיץ";
      $("#itemStatus").value = "בשימוש כרגע";
    }

    showModal("itemModal");
  }

  $("#btnTakePhoto").addEventListener("click", () => $("#photoInputCamera").click());
  $("#btnChooseGallery").addEventListener("click", () => $("#photoInputGallery").click());

  async function handlePhotoFile(file) {
    if (!file) return;
    try {
      toast("מעבד תמונה...", 1000);
      const dataUrl = await compressImage(file);
      currentPhotoDataUrl = dataUrl;
      photoRemoved = false;
      $("#photoPreview").src = dataUrl;
      $("#photoPreview").classList.remove("hidden");
      $("#photoPlaceholder").classList.add("hidden");
      $("#btnRemovePhoto").classList.remove("hidden");
    } catch (err) {
      console.error(err);
      toast("שגיאה בעיבוד התמונה");
    }
  }

  $("#photoInputCamera").addEventListener("change", (e) => {
    handlePhotoFile(e.target.files[0]);
    e.target.value = "";
  });
  $("#photoInputGallery").addEventListener("change", (e) => {
    handlePhotoFile(e.target.files[0]);
    e.target.value = "";
  });

  $("#btnRemovePhoto").addEventListener("click", (e) => {
    e.stopPropagation();
    currentPhotoDataUrl = null;
    photoRemoved = true;
    $("#photoPreview").classList.add("hidden");
    $("#photoPreview").src = "";
    $("#photoPlaceholder").classList.remove("hidden");
    $("#btnRemovePhoto").classList.add("hidden");
  });

  $("#itemForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = $("#itemId").value || uid();
    const isNew = !$("#itemId").value;
    const items = getItems();
    const existing = items.find((i) => i.id === id);

    let imageId = existing ? existing.imageId : null;

    if (photoRemoved && imageId) {
      await idbDelete(imageId);
      imageId = null;
    }
    if (currentPhotoDataUrl) {
      imageId = imageId || id;
      const ok = await idbPut(imageId, currentPhotoDataUrl);
      if (!ok) { toast("שמירת התמונה נכשלה, נסו תמונה קטנה יותר"); return; }
    }

    const record = {
      id,
      childId: $("#itemChild").value || null,
      categoryId: $("#itemCategory").value || null,
      size: $("#itemSize").value.trim(),
      color: $("#itemColor").value.trim(),
      season: $("#itemSeason").value,
      status: $("#itemStatus").value,
      price: $("#itemPrice").value ? Number($("#itemPrice").value) : 0,
      note: $("#itemNote").value.trim(),
      imageId,
      createdAt: existing ? existing.createdAt : Date.now(),
      updatedAt: Date.now(),
    };

    if (existing) {
      const idx = items.findIndex((i) => i.id === id);
      items[idx] = record;
    } else {
      items.push(record);
    }
    setItems(items);
    closeModal("itemModal");
    toast(isNew ? "הפריט נוסף בהצלחה" : "השינויים נשמרו");
    renderItems();
  });

  $("#btnDeleteItem").addEventListener("click", async () => {
    const id = $("#itemId").value;
    if (!id) return;
    const sure = await confirmDialog("למחוק את הפריט הזה? הפעולה אינה הפיכה.");
    if (!sure) return;
    const items = getItems();
    const item = items.find((i) => i.id === id);
    if (item && item.imageId) await idbDelete(item.imageId);
    setItems(items.filter((i) => i.id !== id));
    closeModal("itemModal");
    toast("הפריט נמחק");
    renderItems();
  });

  /* ---------- Children management ---------- */
  function renderChildrenList() {
    const list = $("#childrenList");
    const children = getChildren();
    list.innerHTML = "";
    if (!children.length) {
      list.innerHTML = `<p style="color:var(--ink-soft); font-size:14px; text-align:center; padding:10px;">אין עדיין ילדים. הוסיפו למעלה.</p>`;
      return;
    }
    children.forEach((child) => {
      const li = document.createElement("li");
      li.innerHTML = `
        <input class="item-name-input" type="text" value="${escapeHtml(child.name)}" data-id="${child.id}" />
        <div class="row-actions">
          <button class="row-icon-btn danger" data-action="delete-child" data-id="${child.id}" aria-label="מחיקה">🗑️</button>
        </div>`;
      list.appendChild(li);
    });
  }

  $("#btnAddChild").addEventListener("click", () => {
    const input = $("#newChildName");
    const name = input.value.trim();
    if (!name) { toast("יש להזין שם"); return; }
    const children = getChildren();
    children.push({ id: uid(), name });
    setChildren(children);
    input.value = "";
    renderChildrenList();
    refreshDropdowns();
    renderItems();
  });
  $("#newChildName").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); $("#btnAddChild").click(); } });

  $("#childrenList").addEventListener("change", (e) => {
    if (!e.target.classList.contains("item-name-input")) return;
    const id = e.target.dataset.id;
    const newName = e.target.value.trim();
    if (!newName) { toast("השם לא יכול להיות ריק"); renderChildrenList(); return; }
    const children = getChildren();
    const child = children.find((c) => c.id === id);
    if (child) { child.name = newName; setChildren(children); refreshDropdowns(); renderItems(); toast("העדכון נשמר"); }
  });

  $("#childrenList").addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-action='delete-child']");
    if (!btn) return;
    const id = btn.dataset.id;
    const items = getItems();
    const inUse = items.filter((i) => i.childId === id).length;
    const msg = inUse
      ? `לילד/ה זה משויכים ${inUse} פריטים. מחיקה תשאיר אותם ללא שיוך לילד. להמשיך?`
      : "למחוק את הילד/ה?";
    const sure = await confirmDialog(msg);
    if (!sure) return;
    setChildren(getChildren().filter((c) => c.id !== id));
    if (inUse) {
      const updated = items.map((i) => (i.childId === id ? { ...i, childId: null } : i));
      setItems(updated);
    }
    renderChildrenList();
    refreshDropdowns();
    renderItems();
    toast("נמחק");
  });

  /* ---------- Categories management ---------- */
  function renderCategoriesList() {
    const list = $("#categoriesList");
    const categories = getCategories();
    list.innerHTML = "";
    if (!categories.length) {
      list.innerHTML = `<p style="color:var(--ink-soft); font-size:14px; text-align:center; padding:10px;">אין עדיין קטגוריות. הוסיפו למעלה.</p>`;
      return;
    }
    categories.forEach((cat) => {
      const li = document.createElement("li");
      li.innerHTML = `
        <input class="item-name-input" type="text" value="${escapeHtml(cat.name)}" data-id="${cat.id}" />
        <div class="row-actions">
          <button class="row-icon-btn danger" data-action="delete-cat" data-id="${cat.id}" aria-label="מחיקה">🗑️</button>
        </div>`;
      list.appendChild(li);
    });
  }

  $("#btnAddCategory").addEventListener("click", () => {
    const input = $("#newCategoryName");
    const name = input.value.trim();
    if (!name) { toast("יש להזין שם קטגוריה"); return; }
    const categories = getCategories();
    categories.push({ id: uid(), name });
    setCategories(categories);
    input.value = "";
    renderCategoriesList();
    refreshDropdowns();
    renderItems();
  });
  $("#newCategoryName").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); $("#btnAddCategory").click(); } });

  $("#categoriesList").addEventListener("change", (e) => {
    if (!e.target.classList.contains("item-name-input")) return;
    const id = e.target.dataset.id;
    const newName = e.target.value.trim();
    if (!newName) { toast("השם לא יכול להיות ריק"); renderCategoriesList(); return; }
    const categories = getCategories();
    const cat = categories.find((c) => c.id === id);
    if (cat) { cat.name = newName; setCategories(categories); refreshDropdowns(); renderItems(); toast("העדכון נשמר"); }
  });

  $("#categoriesList").addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-action='delete-cat']");
    if (!btn) return;
    const id = btn.dataset.id;
    const items = getItems();
    const inUse = items.filter((i) => i.categoryId === id).length;
    const msg = inUse
      ? `לקטגוריה זו משויכים ${inUse} פריטים. מחיקה תשאיר אותם ללא קטגוריה. להמשיך?`
      : "למחוק את הקטגוריה?";
    const sure = await confirmDialog(msg);
    if (!sure) return;
    setCategories(getCategories().filter((c) => c.id !== id));
    if (inUse) {
      const updated = items.map((i) => (i.categoryId === id ? { ...i, categoryId: null } : i));
      setItems(updated);
    }
    renderCategoriesList();
    refreshDropdowns();
    renderItems();
    toast("נמחקה");
  });

  /* ---------- AI settings (optional, user's own API key) ---------- */
  const LS_SETTINGS = "kc_settings";
  const getSettings = () => readLS(LS_SETTINGS, {});
  const setSettings = (v) => writeLS(LS_SETTINGS, v);

  $("#btnSaveApiKey").addEventListener("click", () => {
    const key = $("#aiApiKeyInput").value.trim();
    if (key && !key.startsWith("sk-ant-")) {
      toast('מפתחות של Anthropic מתחילים ב-"sk-ant-", בדקו שההעתקה תקינה');
      return;
    }
    setSettings({ ...getSettings(), apiKey: key });
    closeModal("aiSettingsModal");
    toast(key ? "המפתח נשמר על המכשיר בלבד" : "לא נשמר מפתח");
  });
  $("#btnClearApiKey").addEventListener("click", () => {
    setSettings({ ...getSettings(), apiKey: "" });
    $("#aiApiKeyInput").value = "";
    toast("המפתח נמחק");
  });

  /* ---------- Outfit matcher ---------- */
  // Basic Hebrew color-name -> family map, used for offline (no AI) matching.
  const COLOR_FAMILIES = {
    "לבן": "ניטרלי", "שחור": "ניטרלי", "אפור": "ניטרלי", "בז'": "ניטרלי", "בז": "ניטרלי",
    "קרם": "ניטרלי", "חום": "ניטרלי", "ניוד": "ניטרלי",
    "כחול": "קריר", "תכלת": "קריר", "טורקיז": "קריר", "ירוק": "קריר", "מנטה": "קריר", "סגול": "קריר",
    "אדום": "חם", "ורוד": "חם", "כתום": "חם", "בורדו": "חם", "צהוב": "חם", "פוקסיה": "חם", "חרדל": "חם"
  };
  function colorFamily(colorStr) {
    if (!colorStr) return "ניטרלי";
    const clean = colorStr.trim().toLowerCase();
    for (const key of Object.keys(COLOR_FAMILIES)) {
      if (clean.includes(key)) return COLOR_FAMILIES[key];
    }
    return "לא ידוע";
  }

  function openOutfitMatcher() {
    const children = getChildren();
    if (!children.length) {
      toast("יש להוסיף קודם ילד/ה (מהתפריט ☰)");
      return;
    }
    fillSelectOptions($("#outfitChild"), children, null);
    $("#outfitResult").innerHTML = "";
    $("#btnRegenerateOutfit").classList.add("hidden");
    const hasKey = !!getSettings().apiKey;
    $("#outfitAiNote").classList.toggle("hidden", !hasKey);
    showModal("outfitModal");
  }

  function eligibleItemsFor(childId, season) {
    return getItems().filter((it) =>
      it.childId === childId &&
      it.status === "בשימוש כרגע" &&
      (!season || it.season === season || it.season === "בין עונות")
    );
  }

  function heuristicOutfit(items, categories) {
    const byCategory = {};
    items.forEach((it) => {
      const key = it.categoryId || "ללא קטגוריה";
      (byCategory[key] = byCategory[key] || []).push(it);
    });
    const catKeys = Object.keys(byCategory);
    if (!catKeys.length) return null;

    // find the dominant color family among all eligible items to use as an anchor
    const familyCount = {};
    items.forEach((it) => {
      const f = colorFamily(it.color);
      familyCount[f] = (familyCount[f] || 0) + 1;
    });
    let baseFamily = "ניטרלי";
    let max = -1;
    Object.entries(familyCount).forEach(([f, count]) => {
      if (f !== "לא ידוע" && count > max) { max = count; baseFamily = f; }
    });

    const chosen = [];
    catKeys.forEach((catKey) => {
      const options = byCategory[catKey];
      const matching = options.filter((it) => {
        const f = colorFamily(it.color);
        return f === "ניטרלי" || f === baseFamily;
      });
      const pool = matching.length ? matching : options;
      const pick = pool[Math.floor(Math.random() * pool.length)];
      chosen.push({ categoryId: catKey === "ללא קטגוריה" ? null : catKey, item: pick });
    });

    const categoryMap = Object.fromEntries(categories.map((c) => [c.id, c.name]));
    const catNames = chosen.map((c) => categoryMap[c.categoryId] || "ללא קטגוריה");
    const reasoning = `שילוב בגוון ${baseFamily === "לא ידוע" ? "מגוון" : baseFamily} שמחבר בין ${catNames.join(", ")}, מתוך הפריטים שמסומנים "בשימוש כרגע".`;

    return { chosen, reasoning };
  }

  async function aiOutfit(items, categories, apiKey) {
    const categoryMap = Object.fromEntries(categories.map((c) => [c.id, c.name]));
    const simplified = items.map((it) => ({
      id: it.id,
      category: categoryMap[it.categoryId] || "ללא קטגוריה",
      color: it.color || "לא צוין",
      size: it.size || "",
      season: it.season || ""
    }));

    const prompt = `אתה עוזר סטיילינג לילדים. הנה רשימת פריטי לבוש זמינים בפורמט JSON:
${JSON.stringify(simplified)}

בחר פריט אחד (לכל היותר) מכל קטגוריה קיימת, כך שהצבעים משתלבים יפה יחד ליצירת תלבושת הגיונית לילד/ה.
החזר אך ורק אובייקט JSON תקין, ללא טקסט נוסף וללא markdown, בפורמט:
{"itemIds": ["id1","id2", ...], "reasoning": "משפט קצר בעברית שמסביר את הבחירה"}`;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true"
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 500,
        messages: [{ role: "user", content: prompt }]
      })
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      throw new Error(`AI request failed (${response.status}): ${errText}`);
    }
    const data = await response.json();
    const text = (data.content || []).map((b) => b.text || "").join("").trim();
    const clean = text.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(clean);
    const idSet = new Set(parsed.itemIds || []);
    const chosen = items
      .filter((it) => idSet.has(it.id))
      .map((it) => ({ categoryId: it.categoryId, item: it }));
    return { chosen, reasoning: parsed.reasoning || "" };
  }

  function renderOutfitResult(result) {
    const box = $("#outfitResult");
    if (!result || !result.chosen.length) {
      box.innerHTML = `<p style="color:var(--ink-soft); font-size:14px; text-align:center; padding:10px;">לא נמצאו מספיק פריטים "בשימוש כרגע" עבור הבחירה הזו.</p>`;
      $("#btnRegenerateOutfit").classList.add("hidden");
      return;
    }
    const categories = getCategories();
    const categoryMap = Object.fromEntries(categories.map((c) => [c.id, c.name]));

    box.innerHTML = `<div class="outfit-reasoning">${escapeHtml(result.reasoning)}</div>`;
    result.chosen.forEach(({ categoryId, item }) => {
      const row = document.createElement("div");
      row.className = "outfit-item-row";
      row.innerHTML = `
        <div class="outfit-item-photo-slot"></div>
        <div class="outfit-item-text">
          <span class="outfit-item-cat">${escapeHtml(categoryMap[categoryId] || "ללא קטגוריה")}</span>
          <span class="outfit-item-meta">${escapeHtml(item.color || "")}${item.size ? " · מידה " + escapeHtml(item.size) : ""}</span>
        </div>
      `;
      box.appendChild(row);
      const slot = row.querySelector(".outfit-item-photo-slot");
      if (item.imageId) {
        slot.innerHTML = `<div class="outfit-item-photo-placeholder">⏳</div>`;
        idbGet(item.imageId).then((url) => {
          slot.innerHTML = url ? `<img class="outfit-item-photo" src="${url}" alt="" />` : `<div class="outfit-item-photo-placeholder">🧥</div>`;
        });
      } else {
        slot.innerHTML = `<div class="outfit-item-photo-placeholder">🧥</div>`;
      }
    });
    $("#btnRegenerateOutfit").classList.remove("hidden");
  }

  async function generateOutfit() {
    const childId = $("#outfitChild").value;
    if (!childId) { toast("יש לבחור ילד/ה"); return; }
    const season = $("#outfitSeason").value;
    const items = eligibleItemsFor(childId, season);
    const categories = getCategories();

    if (!items.length) {
      renderOutfitResult(null);
      return;
    }

    const apiKey = getSettings().apiKey;
    $("#outfitResult").innerHTML = `<p style="text-align:center; color:var(--ink-soft); font-size:14px;">חושב על שילוב...</p>`;
    $("#btnRegenerateOutfit").classList.add("hidden");

    if (apiKey) {
      try {
        const result = await aiOutfit(items, categories, apiKey);
        renderOutfitResult(result);
        return;
      } catch (e) {
        console.error("AI outfit failed, falling back to offline matching:", e);
        toast("קריאה ל-AI נכשלה, עובר להתאמה מקומית");
      }
    }
    renderOutfitResult(heuristicOutfit(items, categories));
  }

  $("#btnGenerateOutfit").addEventListener("click", generateOutfit);
  $("#btnRegenerateOutfit").addEventListener("click", generateOutfit);

  /* ---------- Export ---------- */
  async function exportData() {
    try {
      toast("מכין קובץ גיבוי...", 1500);
      const children = getChildren();
      const categories = getCategories();
      const items = getItems();
      const images = await idbGetAll();

      const exportObj = {
        appName: "kidsCloset",
        version: 1,
        exportedAt: new Date().toISOString(),
        children,
        categories,
        items,
        images, // { imageId: dataUrl(base64) }
      };

      const json = JSON.stringify(exportObj);
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const dateStr = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = `kidscloset-backup-${dateStr}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      toast("קובץ הגיבוי הורד בהצלחה");
    } catch (e) {
      console.error("export failed", e);
      toast("שגיאה בייצוא הנתונים");
    }
  }

  /* ---------- Import ---------- */
  async function importData(file) {
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!data || !Array.isArray(data.items) || !Array.isArray(data.children) || !Array.isArray(data.categories)) {
        toast("קובץ הגיבוי אינו תקין");
        return;
      }
      const sure = await confirmDialog("ייבוא הקובץ ידרוס את כל הנתונים הקיימים באפליקציה. להמשיך?");
      if (!sure) return;

      setChildren(data.children);
      setCategories(data.categories);
      setItems(data.items);

      // clear existing images then write imported ones
      const db = await openDB();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, "readwrite");
        tx.objectStore(IDB_STORE).clear();
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
      const images = data.images || {};
      const entries = Object.entries(images);
      for (const [id, dataUrl] of entries) {
        if (dataUrl) await idbPut(id, dataUrl);
      }

      refreshDropdowns();
      renderChildrenList();
      renderCategoriesList();
      renderItems();
      toast(`הייבוא הושלם: ${data.items.length} פריטים, ${entries.length} תמונות`);
    } catch (e) {
      console.error("import failed", e);
      toast("שגיאה בייבוא הקובץ - ודאו שזהו קובץ גיבוי תקין");
    }
  }

  /* ---------- Modal helpers (generic overlay/panel pairs) ---------- */
  function showModal(name) {
    $(`#${name}Overlay`).classList.remove("hidden");
    $(`#${name}`).classList.remove("hidden");
  }
  function closeModal(name) {
    $(`#${name}Overlay`).classList.add("hidden");
    $(`#${name}`).classList.add("hidden");
  }

  ["itemModal", "childrenModal", "categoriesModal", "outfitModal", "aiSettingsModal"].forEach((name) => {
    $(`#${name}Overlay`).addEventListener("click", () => closeModal(name));
  });
  $("#itemModalClose").addEventListener("click", () => closeModal("itemModal"));
  $("#childrenModalClose").addEventListener("click", () => closeModal("childrenModal"));
  $("#categoriesModalClose").addEventListener("click", () => closeModal("categoriesModal"));
  $("#outfitModalClose").addEventListener("click", () => closeModal("outfitModal"));
  $("#aiSettingsModalClose").addEventListener("click", () => closeModal("aiSettingsModal"));

  /* ---------- Side menu ---------- */
  function openSideMenu() {
    $("#sideMenuOverlay").classList.remove("hidden");
    $("#sideMenu").classList.remove("hidden");
  }
  function closeSideMenu() {
    $("#sideMenuOverlay").classList.add("hidden");
    $("#sideMenu").classList.add("hidden");
  }
  $("#btnMenu").addEventListener("click", openSideMenu);
  $("#sideMenuOverlay").addEventListener("click", closeSideMenu);

  $("#menuManageChildren").addEventListener("click", () => {
    closeSideMenu();
    renderChildrenList();
    showModal("childrenModal");
  });
  $("#menuManageCategories").addEventListener("click", () => {
    closeSideMenu();
    renderCategoriesList();
    showModal("categoriesModal");
  });
  $("#menuOutfitMatcher").addEventListener("click", () => {
    closeSideMenu();
    openOutfitMatcher();
  });
  $("#menuAiSettings").addEventListener("click", () => {
    closeSideMenu();
    $("#aiApiKeyInput").value = getSettings().apiKey || "";
    showModal("aiSettingsModal");
  });
  $("#menuExport").addEventListener("click", () => {
    closeSideMenu();
    exportData();
  });
  $("#menuImport").addEventListener("click", () => {
    closeSideMenu();
    $("#importFileInput").click();
  });
  $("#importFileInput").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (file) importData(file);
    e.target.value = "";
  });

  /* ---------- FAB & filters ---------- */
  $("#btnAddItem").addEventListener("click", () => openItemModal(null));
  ["filterChild", "filterCategory", "filterSeason", "filterStatus"].forEach((id) => {
    $(`#${id}`).addEventListener("change", renderItems);
  });
  let searchDebounce;
  $("#filterSearch").addEventListener("input", () => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(renderItems, 180);
  });

  /* ---------- PWA: service worker registration ---------- */
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch((err) => {
        console.warn("Service worker registration failed (this is fine when opening via file://):", err);
      });
    });
  }

  /* ---------- Init ---------- */
  function init() {
    refreshDropdowns();
    renderItems();
  }
  init();
})();
