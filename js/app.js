// ============================================================================
// PakWholesellers — Wholesale E-Commerce & WhatsApp Checkout Application Logic
// ============================================================================

(function () {
  "use strict";

  const STORAGE_CART_KEY = "pakwholesellers_cart_v1";
  const STORAGE_PHONE_KEY = "pakwholesellers_wa_phone_v2";
  const STORAGE_BUYER_KEY = "pakwholesellers_buyer_v1";
  const DEFAULT_WA_PHONE = "03174541414";

  const products = window.PAK_PRODUCTS || [];

  // Application State
  const state = {
    activeCategory: "all",
    searchQuery: "",
    storePhone: localStorage.getItem(STORAGE_PHONE_KEY) || DEFAULT_WA_PHONE,
    buyer: loadBuyerInfo(),
    cart: loadCart(),
    cardSelections: {}, // productId -> { qty, size, color }
    quickViewProductId: null
  };

  // Initialize per-product default selections
  products.forEach((p) => {
    state.cardSelections[p.id] = {
      qty: p.moq || 1,
      size: p.defaultSize || p.sizes[0],
      color: p.defaultColor || p.colors[0].name
    };
  });

  function loadCart() {
    try {
      const raw = localStorage.getItem(STORAGE_CART_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }

  function saveCart() {
    try {
      localStorage.setItem(STORAGE_CART_KEY, JSON.stringify(state.cart));
    } catch (e) {
      // ignore storage errors
    }
  }

  function loadBuyerInfo() {
    try {
      const raw = localStorage.getItem(STORAGE_BUYER_KEY);
      if (!raw) return { name: "", city: "", notes: "" };
      return Object.assign({ name: "", city: "", notes: "" }, JSON.parse(raw));
    } catch (e) {
      return { name: "", city: "", notes: "" };
    }
  }

  function saveBuyerInfo() {
    try {
      localStorage.setItem(STORAGE_BUYER_KEY, JSON.stringify(state.buyer));
    } catch (e) {
      // ignore
    }
  }

  // Format currency in PKR
  function formatPKR(amount) {
    return "Rs. " + Number(amount || 0).toLocaleString("en-PK");
  }

  // Calculate active unit price based on wholesale quantity tiers
  function getUnitPriceForQty(product, qty) {
    if (!product.tiers || !product.tiers.length) return product.price;
    let applicablePrice = product.price;
    for (let i = 0; i < product.tiers.length; i++) {
      if (qty >= product.tiers[i].minQty) {
        applicablePrice = product.tiers[i].price;
      }
    }
    return applicablePrice;
  }

  function getActiveTierIndex(product, qty) {
    if (!product.tiers || !product.tiers.length) return 0;
    let idx = 0;
    for (let i = 0; i < product.tiers.length; i++) {
      if (qty >= product.tiers[i].minQty) {
        idx = i;
      }
    }
    return idx;
  }

  // Sanitize WhatsApp phone number to international digits (923174541414)
  function sanitizePhone(phoneStr) {
    let digits = String(phoneStr || "").replace(/[^0-9]/g, "");
    if (digits.startsWith("00")) {
      digits = digits.slice(2);
    } else if (digits.startsWith("03") && digits.length === 11) {
      digits = "92" + digits.slice(1);
    } else if (digits.startsWith("3") && digits.length === 10) {
      digits = "92" + digits;
    }
    return digits || "923174541414";
  }

  // Build pre-written WhatsApp message from cart items
  function buildWhatsAppCartMessage(itemsToOrder) {
    const items = itemsToOrder || state.cart;
    if (!items.length) {
      return "Assalam-o-Alaikum PakWholesellers! I would like to inquire about your wholesale men's clothing catalog.";
    }

    const lines = [];
    lines.push("Assalam-o-Alaikum *PakWholesellers*! 🌿");
    lines.push("I would like to place an order for:");
    lines.push("----------------------------------------");

    let totalUnits = 0;
    let grandTotal = 0;

    items.forEach((item, index) => {
      const product = products.find((p) => p.id === item.productId);
      const unitPrice = product ? getUnitPriceForQty(product, item.qty) : item.unitPrice;
      const lineTotal = unitPrice * item.qty;
      const unitWord = product
        ? item.qty === 1
          ? product.unitLabel
          : product.unitLabelPlural
        : "pcs";

      totalUnits += item.qty;
      grandTotal += lineTotal;

      lines.push(`${index + 1}. *${item.name}*`);
      lines.push(`   • How Many (Qty): *${item.qty} ${unitWord}*`);
      lines.push(`   • Price: *${formatPKR(unitPrice)}* each`);
      lines.push(`   • Item Total: *${formatPKR(lineTotal)}*`);
      lines.push(`   • Color / Size: ${item.color} | ${item.size}`);
      lines.push("");
    });

    lines.push("----------------------------------------");
    lines.push(`*Total Quantity:* ${totalUnits} units`);
    lines.push(`*Grand Total Price:* ${formatPKR(grandTotal)}`);

    if (state.buyer.name || state.buyer.city || state.buyer.notes) {
      lines.push("----------------------------------------");
      if (state.buyer.name) lines.push(`*Name / Shop:* ${state.buyer.name}`);
      if (state.buyer.city) lines.push(`*City / Address:* ${state.buyer.city}`);
      if (state.buyer.notes) lines.push(`*Notes:* ${state.buyer.notes}`);
    }

    lines.push("----------------------------------------");
    lines.push("Please confirm my order. Thank you!");

    return lines.join("\n");
  }

  // Redirect or open WhatsApp with pre-written message
  function redirectToWhatsApp(messageText) {
    const cleanPhone = sanitizePhone(state.storePhone);
    const encodedMsg = encodeURIComponent(messageText);
    const waUrl = `https://wa.me/${cleanPhone}?text=${encodedMsg}`;

    const win = window.open(waUrl, "_blank", "noopener,noreferrer");
    if (!win) {
      window.location.href = waUrl;
    }
    showToast("Redirecting to WhatsApp with your order...", waUrl);
  }

  // Cart Operations
  function addToCart(productId, qty, size, color, openDrawerAfter = false) {
    const product = products.find((p) => p.id === productId);
    if (!product) return;

    const cleanQty = Math.max(1, parseInt(qty, 10) || 1);
    const chosenSize = size || product.defaultSize || product.sizes[0];
    const chosenColor = color || product.defaultColor || product.colors[0].name;

    const existingIndex = state.cart.findIndex(
      (item) =>
        item.productId === productId &&
        item.size === chosenSize &&
        item.color === chosenColor
    );

    if (existingIndex > -1) {
      state.cart[existingIndex].qty += cleanQty;
      state.cart[existingIndex].unitPrice = getUnitPriceForQty(
        product,
        state.cart[existingIndex].qty
      );
    } else {
      state.cart.push({
        cartItemId: `${productId}__${chosenSize}__${chosenColor}`,
        productId: product.id,
        sku: product.sku,
        name: product.name,
        image: product.image,
        size: chosenSize,
        color: chosenColor,
        qty: cleanQty,
        unitPrice: getUnitPriceForQty(product, cleanQty)
      });
    }

    saveCart();
    renderAll();

    showToast(`Added "${product.name}" to Cart`, null, true);

    if (openDrawerAfter) {
      openCartDrawer();
    }
  }

  function updateCartItemQty(cartItemId, newQty) {
    const idx = state.cart.findIndex((i) => i.cartItemId === cartItemId);
    if (idx === -1) return;

    if (newQty <= 0) {
      state.cart.splice(idx, 1);
    } else {
      const item = state.cart[idx];
      const product = products.find((p) => p.id === item.productId);
      item.qty = Math.max(1, parseInt(newQty, 10) || 1);
      if (product) {
        item.unitPrice = getUnitPriceForQty(product, item.qty);
      }
    }
    saveCart();
    renderAll();
  }

  function removeCartItem(cartItemId) {
    state.cart = state.cart.filter((i) => i.cartItemId !== cartItemId);
    saveCart();
    renderAll();
  }

  function clearCart() {
    state.cart = [];
    saveCart();
    renderAll();
  }

  // Compute Cart Totals
  function getCartMetrics() {
    let totalSkus = state.cart.length;
    let totalUnits = 0;
    let subtotal = 0;
    let tierSavings = 0;

    state.cart.forEach((item) => {
      const product = products.find((p) => p.id === item.productId);
      const activeUnitPrice = product
        ? getUnitPriceForQty(product, item.qty)
        : item.unitPrice;
      const baseWholesalePrice = product ? product.price : item.unitPrice;

      totalUnits += item.qty;
      subtotal += activeUnitPrice * item.qty;
      tierSavings += Math.max(0, (baseWholesalePrice - activeUnitPrice) * item.qty);
    });

    return {
      totalSkus,
      totalUnits,
      subtotal,
      tierSavings
    };
  }

  // Filter Products
  function getFilteredProducts() {
    return products.filter((p) => {
      if (state.activeCategory !== "all" && p.category !== state.activeCategory) {
        return false;
      }
      if (state.searchQuery.trim() !== "") {
        const q = state.searchQuery.toLowerCase();
        const matchName = p.name.toLowerCase().includes(q);
        const matchSku = p.sku.toLowerCase().includes(q);
        const matchFabric = p.fabric.toLowerCase().includes(q);
        const matchCat = p.categoryLabel.toLowerCase().includes(q);
        return matchName || matchSku || matchFabric || matchCat;
      }
      return true;
    });
  }

  // Render Category Tabs
  function renderCategoryTabs() {
    const container = document.getElementById("categoryTabs");
    if (!container) return;

    const categories = [
      { id: "all", label: "All" },
      { id: "eastern", label: "Eastern Wear" },
      { id: "waistcoats", label: "Waistcoats" },
      { id: "unstitched", label: "Unstitched" },
      { id: "casual", label: "Casualwear" }
    ];

    container.innerHTML = categories
      .map((cat) => {
        const activeClass = state.activeCategory === cat.id ? "active" : "";
        return `
          <button type="button" class="cat-tab ${activeClass}" data-cat="${cat.id}">
            <span>${cat.label}</span>
          </button>
        `;
      })
      .join("");
  }

  // Render Minimal Product Catalog Grid (ONLY Image, Name, Price & Add to Cart)
  // Clicking the Image or Name opens the Full Product Details Modal!
  function renderProductGrid() {
    const grid = document.getElementById("productGrid");
    if (!grid) return;

    const list = getFilteredProducts();

    if (!list.length) {
      grid.innerHTML = `
        <div style="grid-column: 1 / -1; background: #FFFFFF; border: 1px solid var(--border-subtle); border-radius: var(--radius-md); padding: 40px 20px; text-align: center;">
          <h3 style="font-size: 1.1rem; margin-bottom: 8px;">No products found</h3>
          <button type="button" id="btnResetFilters" class="btn-primary-emerald" style="padding: 9px 18px; font-size: 0.85rem;">Show All</button>
        </div>
      `;
      return;
    }

    grid.innerHTML = list
      .map((p) => {
        const qtyInCart = state.cart
          .filter((i) => i.productId === p.id)
          .reduce((sum, i) => sum + i.qty, 0);

        return `
          <article class="product-card ${qtyInCart > 0 ? "in-cart" : ""}" data-product-card="${p.id}">
            <div class="product-media" data-action="quick-view" data-product-id="${p.id}" title="Click image to view full details">
              <img src="${p.image}" alt="${p.name}" loading="lazy" />
              ${
                qtyInCart > 0
                  ? `<div class="in-cart-ribbon">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"></polyline></svg>
                      <span>${qtyInCart} in Cart</span>
                    </div>`
                  : `<span class="tap-details-hint">Tap for details</span>`
              }
            </div>

            <div class="product-body-minimal">
              <h3 class="product-title-minimal" data-action="quick-view" data-product-id="${p.id}">${p.name}</h3>
              <div class="product-price-minimal">${formatPKR(p.price)}</div>
              <button
                type="button"
                class="btn-add-to-cart-minimal"
                data-action="add-to-cart"
                data-product-id="${p.id}"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="9" cy="21" r="1"></circle>
                  <circle cx="20" cy="21" r="1"></circle>
                  <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path>
                </svg>
                <span>Add to Cart</span>
              </button>
            </div>
          </article>
        `;
      })
      .join("");
  }

  // Render Header Badges, Cart Drawer, and Floating Cart Bar
  function renderCartUI() {
    const metrics = getCartMetrics();

    const headerCount = document.getElementById("headerCartCount");
    if (headerCount) headerCount.textContent = metrics.totalUnits;

    const floatingBar = document.getElementById("floatingCartBar");
    const floatingCount = document.getElementById("floatingCartUnits");
    const floatingTotal = document.getElementById("floatingCartTotal");
    if (floatingBar) {
      if (metrics.totalUnits > 0) {
        floatingBar.classList.add("visible");
      } else {
        floatingBar.classList.remove("visible");
      }
    }
    if (floatingCount) {
      floatingCount.textContent = `${metrics.totalSkus} item${metrics.totalSkus === 1 ? "" : "s"} (${metrics.totalUnits} pcs)`;
    }
    if (floatingTotal) {
      floatingTotal.textContent = formatPKR(metrics.subtotal);
    }

    const drawerBody = document.getElementById("cartDrawerBody");
    const summarySkus = document.getElementById("summaryTotalSkus");
    const summaryUnits = document.getElementById("summaryTotalUnits");
    const summarySavingsRow = document.getElementById("summarySavingsRow");
    const summarySavingsVal = document.getElementById("summarySavingsVal");
    const summaryGrandTotal = document.getElementById("summaryGrandTotal");
    const btnWhatsappCheckout = document.getElementById("btnWhatsappCheckout");

    if (summarySkus) summarySkus.textContent = `${metrics.totalSkus} products`;
    if (summaryUnits) summaryUnits.textContent = `${metrics.totalUnits} pieces`;
    if (summarySavingsRow && summarySavingsVal) {
      if (metrics.tierSavings > 0) {
        summarySavingsRow.style.display = "flex";
        summarySavingsVal.textContent = "− " + formatPKR(metrics.tierSavings);
      } else {
        summarySavingsRow.style.display = "none";
      }
    }
    if (summaryGrandTotal) {
      summaryGrandTotal.textContent = formatPKR(metrics.subtotal);
    }
    if (btnWhatsappCheckout) {
      btnWhatsappCheckout.disabled = state.cart.length === 0;
    }

    if (!drawerBody) return;

    if (state.cart.length === 0) {
      drawerBody.innerHTML = `
        <div class="cart-empty-state">
          <div class="empty-icon-circle">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="9" cy="21" r="1"></circle>
              <circle cx="20" cy="21" r="1"></circle>
              <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path>
            </svg>
          </div>
          <h4 style="font-size: 1.05rem; color: var(--text-primary); margin-bottom: 6px;">Your Cart is Empty</h4>
          <p style="font-size: 0.85rem; margin-bottom: 18px;">Add products from the catalog to order via WhatsApp.</p>
          <button type="button" class="btn-primary-emerald" id="btnBrowseFromEmptyCart" style="padding: 10px 20px; font-size: 0.86rem;">
            Explore Collection
          </button>
        </div>
      `;
      return;
    }

    const itemsHtml = state.cart
      .map((item) => {
        const product = products.find((p) => p.id === item.productId);
        const unitPrice = product
          ? getUnitPriceForQty(product, item.qty)
          : item.unitPrice;
        const lineTotal = unitPrice * item.qty;

        return `
          <div class="cart-item-card">
            <img src="${item.image}" alt="${item.name}" class="cart-item-thumb" />
            <div class="cart-item-info">
              <div class="cart-item-top">
                <div class="cart-item-title">${item.name}</div>
                <button
                  type="button"
                  class="btn-remove-item"
                  data-action="remove-cart-item"
                  data-cart-item-id="${item.cartItemId}"
                  title="Remove item"
                >✕</button>
              </div>
              <div class="cart-item-variants">
                <span>${item.color}</span>
                <span>${item.size}</span>
              </div>
              <div class="cart-item-bottom">
                <div>
                  <div class="cart-item-unit-price">${formatPKR(unitPrice)} × ${item.qty}</div>
                  <div class="cart-item-subtotal">${formatPKR(lineTotal)}</div>
                </div>
                <div class="qty-stepper">
                  <button
                    type="button"
                    class="qty-btn"
                    data-action="cart-qty-dec"
                    data-cart-item-id="${item.cartItemId}"
                  >−</button>
                  <input
                    type="number"
                    min="1"
                    max="9999"
                    value="${item.qty}"
                    class="qty-input"
                    data-action="cart-qty-input"
                    data-cart-item-id="${item.cartItemId}"
                  />
                  <button
                    type="button"
                    class="qty-btn"
                    data-action="cart-qty-inc"
                    data-cart-item-id="${item.cartItemId}"
                  >+</button>
                </div>
              </div>
            </div>
          </div>
        `;
      })
      .join("");

    const waPreviewMessage = buildWhatsAppCartMessage(state.cart);

    drawerBody.innerHTML = `
      <div class="cart-items-list">
        ${itemsHtml}
      </div>

      <!-- Optional Buyer Info to Include in WhatsApp Message -->
      <div class="buyer-details-box">
        <div class="buyer-details-title">
          <span>Your Info (Optional)</span>
        </div>
        <div class="buyer-form-grid">
          <input
            type="text"
            id="buyerNameInput"
            class="buyer-input"
            placeholder="Your Name / Shop"
            value="${escapeHtml(state.buyer.name)}"
          />
          <input
            type="text"
            id="buyerCityInput"
            class="buyer-input"
            placeholder="City"
            value="${escapeHtml(state.buyer.city)}"
          />
        </div>
      </div>

      <!-- Live Pre-Written WhatsApp Message Preview -->
      <div class="wa-preview-box">
        <div class="wa-preview-header">
          <span>📋 Pre-Written WhatsApp Message</span>
          <button type="button" class="btn-copy-msg" id="btnCopyWaMessage">Copy</button>
        </div>
        <pre class="wa-preview-text" id="waLivePreviewText">${escapeHtml(waPreviewMessage)}</pre>
      </div>
    `;

    const nameInp = document.getElementById("buyerNameInput");
    const cityInp = document.getElementById("buyerCityInput");
    const previewEl = document.getElementById("waLivePreviewText");

    function handleBuyerFieldChange() {
      state.buyer.name = nameInp ? nameInp.value : "";
      state.buyer.city = cityInp ? cityInp.value : "";
      saveBuyerInfo();
      if (previewEl) {
        previewEl.textContent = buildWhatsAppCartMessage(state.cart);
      }
    }

    if (nameInp) nameInp.addEventListener("input", handleBuyerFieldChange);
    if (cityInp) cityInp.addEventListener("input", handleBuyerFieldChange);

    const copyBtn = document.getElementById("btnCopyWaMessage");
    if (copyBtn) {
      copyBtn.addEventListener("click", () => {
        const msg = buildWhatsAppCartMessage(state.cart);
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(msg);
        }
        copyBtn.textContent = "✓ Copied";
        setTimeout(() => {
          copyBtn.textContent = "Copy";
        }, 1800);
      });
    }
  }

  function escapeHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // Open / Close Cart Drawer
  function openCartDrawer() {
    const backdrop = document.getElementById("cartDrawerBackdrop");
    const drawer = document.getElementById("cartDrawer");
    if (backdrop) backdrop.classList.add("open");
    if (drawer) drawer.classList.add("open");
    document.body.style.overflow = "hidden";
  }

  function closeCartDrawer() {
    const backdrop = document.getElementById("cartDrawerBackdrop");
    const drawer = document.getElementById("cartDrawer");
    if (backdrop) backdrop.classList.remove("open");
    if (drawer) drawer.classList.remove("open");
    document.body.style.overflow = "";
  }

  // Full Product Details Modal (Triggered when clicking product image or title)
  function openQuickView(productId) {
    const product = products.find((p) => p.id === productId);
    if (!product) return;
    state.quickViewProductId = productId;

    const modalBackdrop = document.getElementById("quickViewBackdrop");
    const modalContent = document.getElementById("quickViewContainer");
    if (!modalBackdrop || !modalContent) return;

    renderQuickViewContent(product, modalContent);
    modalBackdrop.classList.add("open");
    document.body.style.overflow = "hidden";
  }

  function renderQuickViewContent(product, modalContent) {
    const sel = state.cardSelections[product.id];
    const unitPrice = getUnitPriceForQty(product, sel.qty);
    const activeTierIdx = getActiveTierIndex(product, sel.qty);
    const lineTotal = unitPrice * sel.qty;

    const tiersHtml = product.tiers
      .map((t, idx) => {
        const isActive = idx === activeTierIdx ? "active-tier" : "";
        return `
          <div class="tier-mini ${isActive}">
            <span class="tier-mini-qty">${t.label}</span>
            <span class="tier-mini-price">${formatPKR(t.price)}</span>
          </div>
        `;
      })
      .join("");

    const colorsHtml = product.colors
      .map((c) => {
        const isSelected = sel.color === c.name ? "active" : "";
        return `
          <button
            type="button"
            class="color-swatch-btn ${isSelected}"
            style="background-color: ${c.hex};"
            title="${c.name}"
            data-qv-color="${c.name}"
          ></button>
        `;
      })
      .join("");

    const sizesOptionsHtml = product.sizes
      .map((s) => {
        const selectedAttr = sel.size === s ? "selected" : "";
        return `<option value="${s}" ${selectedAttr}>${s}</option>`;
      })
      .join("");

    modalContent.innerHTML = `
      <div class="quickview-grid">
        <div class="quickview-media">
          <img src="${product.image}" alt="${product.name}" />
          <button type="button" class="btn-close-qv-mobile" id="btnCloseQuickView">✕</button>
        </div>
        <div class="quickview-content">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <span class="badge-pill badge-emerald">${product.categoryLabel} • ${product.sku}</span>
            <button type="button" id="btnCloseQuickViewDesktop" style="font-size:1.25rem; font-weight:800; color:var(--text-secondary); padding:2px 8px;">✕</button>
          </div>

          <h2 style="font-family:var(--font-display); font-size:1.35rem; line-height:1.22;">${product.name}</h2>

          <div class="price-tier-box">
            <div class="price-main-row">
              <div class="wholesale-price">
                ${formatPKR(unitPrice)} <small>/ ${product.unitLabel}</small>
              </div>
              <div class="retail-compare">
                Retail: <del>${formatPKR(product.retailPrice)}</del>
              </div>
            </div>
            <div class="tier-pills-row">
              ${tiersHtml}
            </div>
          </div>

          <p style="font-size:0.86rem; color:var(--text-secondary);">${product.description}</p>
          <div style="font-size:0.8rem; background:var(--green-50); padding:8px 11px; border-radius:8px; border:1px solid var(--border-strong);">
            <strong>Fabric:</strong> ${product.fabric} • <strong>MOQ:</strong> ${product.moq} ${product.unitLabelPlural}
          </div>

          <!-- Color & Size Selectors inside Modal -->
          <div class="card-selectors">
            <div class="selector-row">
              <span class="selector-label">Color: <strong style="color: var(--text-primary);">${sel.color}</strong></span>
              <div class="color-swatches">
                ${colorsHtml}
              </div>
            </div>
            <div>
              <select class="size-select-compact" id="qvSizeSelect" aria-label="Select Size or Pack">
                ${sizesOptionsHtml}
              </select>
            </div>
          </div>

          <!-- How Many (Quantity) Stepper inside Modal -->
          <div class="card-qty-block">
            <div class="qty-top-row">
              <span class="qty-label">How Many (${product.unitLabelPlural}):</span>
              <div class="qty-stepper">
                <button type="button" class="qty-btn" id="qvQtyDec">−</button>
                <input
                  type="number"
                  min="1"
                  max="9999"
                  value="${sel.qty}"
                  class="qty-input"
                  id="qvQtyInput"
                />
                <button type="button" class="qty-btn" id="qvQtyInc">+</button>
              </div>
            </div>
            <div class="qty-presets-row">
              <div class="preset-chips">
                <button type="button" class="preset-chip" data-qv-preset="${product.moq}">MOQ (${product.moq})</button>
                <button type="button" class="preset-chip" data-qv-preset="${product.tiers[1] ? product.tiers[1].minQty : 10}">${product.tiers[1] ? product.tiers[1].minQty : 10} pcs</button>
                <button type="button" class="preset-chip" data-qv-preset="${product.tiers[2] ? product.tiers[2].minQty : 25}">${product.tiers[2] ? product.tiers[2].minQty : 25} pcs</button>
              </div>
              <span class="card-line-subtotal">Total: ${formatPKR(lineTotal)}</span>
            </div>
          </div>

          <!-- Modal Actions -->
          <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px; margin-top:4px;">
            <button type="button" class="btn-add-to-cart" id="btnQuickViewAddCart">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3">
                <circle cx="9" cy="21" r="1"></circle><circle cx="20" cy="21" r="1"></circle>
                <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path>
              </svg>
              <span>Add to Cart</span>
            </button>
            <button type="button" class="btn-whatsapp-checkout" id="btnQuickViewDirectWa" style="padding:12px 14px; font-size:0.88rem;">
              <span>Buy on WhatsApp</span>
            </button>
          </div>
        </div>
      </div>
    `;

    // Bind Quick View interactive events
    const closeM = document.getElementById("btnCloseQuickView");
    const closeD = document.getElementById("btnCloseQuickViewDesktop");
    if (closeM) closeM.addEventListener("click", closeQuickView);
    if (closeD) closeD.addEventListener("click", closeQuickView);

    modalContent.querySelectorAll("[data-qv-color]").forEach((btn) => {
      btn.addEventListener("click", () => {
        sel.color = btn.getAttribute("data-qv-color");
        renderQuickViewContent(product, modalContent);
      });
    });

    const sizeSel = document.getElementById("qvSizeSelect");
    if (sizeSel) {
      sizeSel.addEventListener("change", (e) => {
        sel.size = e.target.value;
      });
    }

    const decBtn = document.getElementById("qvQtyDec");
    const incBtn = document.getElementById("qvQtyInc");
    const qtyInp = document.getElementById("qvQtyInput");

    if (decBtn) {
      decBtn.addEventListener("click", () => {
        sel.qty = Math.max(1, sel.qty - 1);
        renderQuickViewContent(product, modalContent);
      });
    }
    if (incBtn) {
      incBtn.addEventListener("click", () => {
        sel.qty = sel.qty + 1;
        renderQuickViewContent(product, modalContent);
      });
    }
    if (qtyInp) {
      qtyInp.addEventListener("change", (e) => {
        sel.qty = Math.max(1, parseInt(e.target.value, 10) || 1);
        renderQuickViewContent(product, modalContent);
      });
    }

    modalContent.querySelectorAll("[data-qv-preset]").forEach((chip) => {
      chip.addEventListener("click", () => {
        sel.qty = parseInt(chip.getAttribute("data-qv-preset"), 10) || 1;
        renderQuickViewContent(product, modalContent);
      });
    });

    const addBtn = document.getElementById("btnQuickViewAddCart");
    if (addBtn) {
      addBtn.addEventListener("click", () => {
        addToCart(product.id, sel.qty, sel.size, sel.color, true);
        closeQuickView();
      });
    }

    const waBtn = document.getElementById("btnQuickViewDirectWa");
    if (waBtn) {
      waBtn.addEventListener("click", () => {
        const singleOrderMsg = buildWhatsAppCartMessage([
          {
            productId: product.id,
            sku: product.sku,
            name: product.name,
            size: sel.size,
            color: sel.color,
            qty: sel.qty,
            unitPrice: getUnitPriceForQty(product, sel.qty)
          }
        ]);
        redirectToWhatsApp(singleOrderMsg);
      });
    }
  }

  function closeQuickView() {
    const modalBackdrop = document.getElementById("quickViewBackdrop");
    if (modalBackdrop) modalBackdrop.classList.remove("open");
    document.body.style.overflow = "";
    state.quickViewProductId = null;
  }

  // Toast Notification
  function showToast(message, optionalWaUrl = null, showViewCartBtn = false) {
    const container = document.getElementById("toastContainer");
    if (!container) return;

    const toast = document.createElement("div");
    toast.className = "toast-item";
    toast.innerHTML = `
      <span>${escapeHtml(message)}</span>
      ${
        showViewCartBtn
          ? `<button type="button" style="background:#4ADE80; color:#042214; font-weight:800; font-size:0.75rem; padding:5px 10px; border-radius:99px; white-space:nowrap;" class="toast-open-cart-btn">View Cart →</button>`
          : ""
      }
      ${
        optionalWaUrl
          ? `<a href="${optionalWaUrl}" target="_blank" rel="noopener noreferrer" style="background:#25D366; color:#FFFFFF; font-weight:800; font-size:0.75rem; padding:5px 10px; border-radius:99px; text-decoration:none; white-space:nowrap;">Open WhatsApp ↗</a>`
          : ""
      }
    `;

    const openCartBtn = toast.querySelector(".toast-open-cart-btn");
    if (openCartBtn) {
      openCartBtn.addEventListener("click", () => {
        openCartDrawer();
        toast.remove();
      });
    }

    container.appendChild(toast);
    setTimeout(() => {
      if (toast.parentNode) {
        toast.remove();
      }
    }, 3800);
  }

  function renderAll() {
    renderCategoryTabs();
    renderProductGrid();
    renderCartUI();
  }

  // Event Listeners Setup
  function setupEventListeners() {
    window.addEventListener("scroll", () => {
      const header = document.getElementById("siteHeader");
      if (header) {
        header.classList.toggle("scrolled", window.scrollY > 12);
      }
    });

    const catTabs = document.getElementById("categoryTabs");
    if (catTabs) {
      catTabs.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-cat]");
        if (!btn) return;
        state.activeCategory = btn.getAttribute("data-cat");
        renderAll();
      });
    }

    const searchInput = document.getElementById("catalogSearchInput");
    const searchClearBtn = document.getElementById("searchClearBtn");
    if (searchInput) {
      searchInput.addEventListener("input", (e) => {
        state.searchQuery = e.target.value;
        if (searchClearBtn) {
          searchClearBtn.classList.toggle("visible", state.searchQuery.length > 0);
        }
        renderProductGrid();
      });
    }
    if (searchClearBtn) {
      searchClearBtn.addEventListener("click", () => {
        state.searchQuery = "";
        if (searchInput) searchInput.value = "";
        searchClearBtn.classList.remove("visible");
        renderProductGrid();
      });
    }

    const productGrid = document.getElementById("productGrid");
    if (productGrid) {
      productGrid.addEventListener("click", (e) => {
        if (e.target.id === "btnResetFilters") {
          state.activeCategory = "all";
          state.searchQuery = "";
          if (searchInput) searchInput.value = "";
          if (searchClearBtn) searchClearBtn.classList.remove("visible");
          renderAll();
          return;
        }

        const actionEl = e.target.closest("[data-action]");
        if (!actionEl) return;

        const action = actionEl.getAttribute("data-action");
        const productId = actionEl.getAttribute("data-product-id");
        if (!productId) return;

        const sel = state.cardSelections[productId];
        const product = products.find((p) => p.id === productId);
        if (!sel || !product) return;

        if (action === "add-to-cart") {
          addToCart(productId, 1, sel.size, sel.color, false);
        } else if (action === "quick-view") {
          openQuickView(productId);
        }
      });
    }

    const btnOpenCart = document.getElementById("btnHeaderCart");
    const btnFloatingCart = document.getElementById("btnFloatingOpenCart");
    const btnCloseCart = document.getElementById("btnCloseCartDrawer");
    const cartBackdrop = document.getElementById("cartDrawerBackdrop");

    if (btnOpenCart) btnOpenCart.addEventListener("click", openCartDrawer);
    if (btnFloatingCart) btnFloatingCart.addEventListener("click", openCartDrawer);
    if (btnCloseCart) btnCloseCart.addEventListener("click", closeCartDrawer);
    if (cartBackdrop) cartBackdrop.addEventListener("click", closeCartDrawer);

    const cartDrawerBody = document.getElementById("cartDrawerBody");
    if (cartDrawerBody) {
      cartDrawerBody.addEventListener("click", (e) => {
        if (e.target.id === "btnBrowseFromEmptyCart") {
          closeCartDrawer();
          const catalogEl = document.getElementById("catalog");
          if (catalogEl) catalogEl.scrollIntoView({ behavior: "smooth" });
          return;
        }

        const actionEl = e.target.closest("[data-action]");
        if (!actionEl) return;
        const action = actionEl.getAttribute("data-action");
        const cartItemId = actionEl.getAttribute("data-cart-item-id");
        if (!cartItemId) return;

        const item = state.cart.find((i) => i.cartItemId === cartItemId);
        if (!item) return;

        if (action === "remove-cart-item") {
          removeCartItem(cartItemId);
        } else if (action === "cart-qty-dec") {
          updateCartItemQty(cartItemId, item.qty - 1);
        } else if (action === "cart-qty-inc") {
          updateCartItemQty(cartItemId, item.qty + 1);
        }
      });

      cartDrawerBody.addEventListener("change", (e) => {
        const target = e.target;
        if (target.getAttribute("data-action") === "cart-qty-input") {
          const cartItemId = target.getAttribute("data-cart-item-id");
          const val = parseInt(target.value, 10) || 1;
          updateCartItemQty(cartItemId, val);
        }
      });
    }

    const btnClearCart = document.getElementById("btnClearCart");
    if (btnClearCart) {
      btnClearCart.addEventListener("click", clearCart);
    }

    const btnWhatsappCheckout = document.getElementById("btnWhatsappCheckout");
    if (btnWhatsappCheckout) {
      btnWhatsappCheckout.addEventListener("click", () => {
        if (!state.cart.length) return;
        const msg = buildWhatsAppCartMessage(state.cart);
        redirectToWhatsApp(msg);
      });
    }

    const btnFloatingBuyWa = document.getElementById("btnFloatingBuyWa");
    if (btnFloatingBuyWa) {
      btnFloatingBuyWa.addEventListener("click", () => {
        if (!state.cart.length) {
          openCartDrawer();
          return;
        }
        const msg = buildWhatsAppCartMessage(state.cart);
        redirectToWhatsApp(msg);
      });
    }

    const quickViewBackdrop = document.getElementById("quickViewBackdrop");
    if (quickViewBackdrop) {
      quickViewBackdrop.addEventListener("click", (e) => {
        if (e.target === quickViewBackdrop) {
          closeQuickView();
        }
      });
    }

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        closeQuickView();
        closeCartDrawer();
      }
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    renderAll();
    setupEventListeners();
  });
})();
