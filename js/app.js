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
    sortBy: "featured",
    storePhone: localStorage.getItem(STORAGE_PHONE_KEY) || DEFAULT_WA_PHONE,
    buyer: loadBuyerInfo(),
    cart: loadCart(),
    cardSelections: {}, // productId -> { qty, size, color }
    quickViewProductId: null
  };

  // Initialize per-card default selections
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

  // Sanitize WhatsApp phone number to international digits (e.g. 923174541414)
  function sanitizePhone(phoneStr) {
    let digits = String(phoneStr || "").replace(/[^0-9]/g, "");
    if (digits.startsWith("00")) {
      digits = digits.slice(2);
    } else if (digits.startsWith("03") && digits.length === 11) {
      // Convert local Pakistani mobile 03XX-XXXXXXX to 923XXXXXXXXX
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
    lines.push("I would like to place a wholesale order with the following items:");
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

      lines.push(
        `${index + 1}. *${item.name}* (${item.sku})`
      );
      lines.push(
        `   • How Many (Qty): *${item.qty} ${unitWord}*`
      );
      lines.push(
        `   • Unit Price: *${formatPKR(unitPrice)}*`
      );
      lines.push(
        `   • Item Total: *${formatPKR(lineTotal)}*`
      );
      lines.push(
        `   • Color / Size: ${item.color} | ${item.size}`
      );
      lines.push("");
    });

    lines.push("----------------------------------------");
    lines.push(`*Total Products:* ${items.length}`);
    lines.push(`*Total Quantity (How Many):* ${totalUnits} units`);
    lines.push(`*Grand Total Price:* ${formatPKR(grandTotal)}`);

    if (state.buyer.name || state.buyer.city || state.buyer.notes) {
      lines.push("----------------------------------------");
      if (state.buyer.name) lines.push(`*Buyer / Shop Name:* ${state.buyer.name}`);
      if (state.buyer.city) lines.push(`*Delivery City / Address:* ${state.buyer.city}`);
      if (state.buyer.notes) lines.push(`*Order Notes:* ${state.buyer.notes}`);
    }

    lines.push("----------------------------------------");
    lines.push("Please confirm stock availability and payment/dispatch details. Thank you!");

    return lines.join("\n");
  }

  // Redirect or open WhatsApp with pre-written message
  function redirectToWhatsApp(messageText) {
    const cleanPhone = sanitizePhone(state.storePhone);
    const encodedMsg = encodeURIComponent(messageText);
    const waUrl = `https://wa.me/${cleanPhone}?text=${encodedMsg}`;

    // Open in new tab and also show a confirmation toast with direct link in case popup blocker intercepts
    const win = window.open(waUrl, "_blank", "noopener,noreferrer");
    if (!win) {
      window.location.href = waUrl;
    }
    showToast("Redirecting to WhatsApp with your pre-written order message...", waUrl);
  }

  // Cart Operations
  function addToCart(productId, qty, size, color, openDrawerAfter = false) {
    const product = products.find((p) => p.id === productId);
    if (!product) return;

    const cleanQty = Math.max(1, parseInt(qty, 10) || product.moq || 1);
    const chosenSize = size || product.defaultSize || product.sizes[0];
    const chosenColor = color || product.defaultColor || product.colors[0].name;

    // Check if identical product + size + color exists in cart
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

    const unitPriceNow = getUnitPriceForQty(product, cleanQty);
    showToast(
      `Added ${cleanQty} × "${product.name}" (${formatPKR(unitPriceNow)} each) to Cart`,
      null,
      true
    );

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
    let baseRetailValue = 0;
    let tierSavings = 0;

    state.cart.forEach((item) => {
      const product = products.find((p) => p.id === item.productId);
      const activeUnitPrice = product
        ? getUnitPriceForQty(product, item.qty)
        : item.unitPrice;
      const baseWholesalePrice = product ? product.price : item.unitPrice;

      totalUnits += item.qty;
      subtotal += activeUnitPrice * item.qty;
      baseRetailValue += (product ? product.retailPrice : activeUnitPrice) * item.qty;
      tierSavings += Math.max(0, (baseWholesalePrice - activeUnitPrice) * item.qty);
    });

    return {
      totalSkus,
      totalUnits,
      subtotal,
      baseRetailValue,
      tierSavings
    };
  }

  // Filter & Sort Products
  function getFilteredProducts() {
    return products
      .filter((p) => {
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
      })
      .sort((a, b) => {
        if (state.sortBy === "price-asc") return a.price - b.price;
        if (state.sortBy === "price-desc") return b.price - a.price;
        if (state.sortBy === "moq-asc") return a.moq - b.moq;
        return 0;
      });
  }

  // Render Category Tabs with Counts
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
        const count =
          cat.id === "all"
            ? products.length
            : products.filter((p) => p.category === cat.id).length;
        const activeClass = state.activeCategory === cat.id ? "active" : "";
        return `
          <button type="button" class="cat-tab ${activeClass}" data-cat="${cat.id}">
            <span>${cat.label}</span>
            <span class="cat-tab-count">${count}</span>
          </button>
        `;
      })
      .join("");
  }

  // Render Product Catalog Grid
  function renderProductGrid() {
    const grid = document.getElementById("productGrid");
    const countLabel = document.getElementById("catalogResultCount");
    if (!grid) return;

    const list = getFilteredProducts();
    if (countLabel) {
      countLabel.textContent = `${list.length} Products`;
    }

    if (!list.length) {
      grid.innerHTML = `
        <div style="grid-column: 1 / -1; background: #FFFFFF; border: 1px solid var(--border-subtle); border-radius: var(--radius-md); padding: 48px 24px; text-align: center;">
          <h3 style="font-size: 1.2rem; margin-bottom: 8px;">No matching wholesale products found</h3>
          <p style="color: var(--text-secondary); margin-bottom: 16px;">Try clearing your search query or switching to "All Wholesale Items".</p>
          <button type="button" id="btnResetFilters" class="btn-primary-emerald" style="padding: 10px 20px;">Show All Products</button>
        </div>
      `;
      return;
    }

    grid.innerHTML = list
      .map((p) => {
        const sel = state.cardSelections[p.id] || {
          qty: p.moq,
          size: p.defaultSize,
          color: p.defaultColor
        };
        const activeUnitPrice = getUnitPriceForQty(p, sel.qty);
        const activeTierIdx = getActiveTierIndex(p, sel.qty);
        const lineSubtotal = activeUnitPrice * sel.qty;

        // Check how many of this product are already in cart
        const qtyInCart = state.cart
          .filter((i) => i.productId === p.id)
          .reduce((sum, i) => sum + i.qty, 0);

        const badgeClass =
          p.badgeType === "brass" ? "badge-brass" : "badge-emerald";

        const tiersHtml = p.tiers
          .map((t, idx) => {
            const isTierActive = idx === activeTierIdx ? "active-tier" : "";
            return `
              <div class="tier-mini ${isTierActive}">
                <span class="tier-mini-qty">${t.label}</span>
                <span class="tier-mini-price">${formatPKR(t.price)}</span>
              </div>
            `;
          })
          .join("");

        const colorsHtml = p.colors
          .map((c) => {
            const isSelected = sel.color === c.name ? "active" : "";
            return `
              <button
                type="button"
                class="color-swatch-btn ${isSelected}"
                style="background-color: ${c.hex};"
                title="${c.name}"
                data-action="select-color"
                data-product-id="${p.id}"
                data-color="${c.name}"
                aria-label="Select color ${c.name}"
              ></button>
            `;
          })
          .join("");

        const sizesOptionsHtml = p.sizes
          .map((s) => {
            const selectedAttr = sel.size === s ? "selected" : "";
            return `<option value="${s}" ${selectedAttr}>${s}</option>`;
          })
          .join("");

        return `
          <article class="product-card ${qtyInCart > 0 ? "in-cart" : ""}" data-product-card="${p.id}">
            <div class="product-media">
              <img src="${p.image}" alt="${p.name}" loading="lazy" />
              <div class="product-badges-top">
                <span class="badge-pill ${badgeClass}">${p.badge}</span>
                <span class="badge-moq">MOQ: ${p.moq} ${p.qty === 1 ? p.unitLabel : p.unitLabelPlural}</span>
              </div>
              ${
                qtyInCart > 0
                  ? `<div class="in-cart-ribbon">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"></polyline></svg>
                      <span>In Cart: ${qtyInCart}</span>
                    </div>`
                  : ""
              }
              <button type="button" class="btn-quick-view" data-action="quick-view" data-product-id="${p.id}">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                Details
              </button>
            </div>

            <div class="product-body">
              <div class="product-meta-row">
                <span>${p.categoryLabel}</span>
                <span class="product-sku">${p.sku}</span>
              </div>

              <h3 class="product-title" data-action="quick-view" data-product-id="${p.id}">${p.name}</h3>
              <p class="product-fabric">${p.fabric}</p>

              <!-- Wholesale Price & Bulk Tier Box -->
              <div class="price-tier-box">
                <div class="price-main-row">
                  <div class="wholesale-price">
                    ${formatPKR(activeUnitPrice)} <small>/ ${p.unitLabel}</small>
                  </div>
                  <div class="retail-compare">
                    Retail: <del>${formatPKR(p.retailPrice)}</del>
                  </div>
                </div>
                <div class="tier-pills-row">
                  ${tiersHtml}
                </div>
              </div>

              <!-- Color & Size Selectors -->
              <div class="card-selectors">
                <div class="selector-row">
                  <span class="selector-label">Color: <strong style="color: var(--text-primary);">${sel.color}</strong></span>
                  <div class="color-swatches">
                    ${colorsHtml}
                  </div>
                </div>
                <div>
                  <select class="size-select-compact" data-action="select-size" data-product-id="${p.id}" aria-label="Select Size or Pack">
                    ${sizesOptionsHtml}
                  </select>
                </div>
              </div>

              <!-- Quantity Selector & Live Subtotal -->
              <div class="card-qty-block">
                <div class="qty-top-row">
                  <span class="qty-label">How Many (${p.unitLabelPlural}):</span>
                  <div class="qty-stepper">
                    <button type="button" class="qty-btn" data-action="card-qty-dec" data-product-id="${p.id}" aria-label="Decrease quantity">−</button>
                    <input
                      type="number"
                      min="1"
                      max="9999"
                      value="${sel.qty}"
                      class="qty-input"
                      data-action="card-qty-input"
                      data-product-id="${p.id}"
                      aria-label="Quantity"
                    />
                    <button type="button" class="qty-btn" data-action="card-qty-inc" data-product-id="${p.id}" aria-label="Increase quantity">+</button>
                  </div>
                </div>
                <div class="qty-presets-row">
                  <div class="preset-chips">
                    <button type="button" class="preset-chip" data-action="card-qty-set" data-product-id="${p.id}" data-qty="${p.moq}">MOQ (${p.moq})</button>
                    <button type="button" class="preset-chip" data-action="card-qty-set" data-product-id="${p.id}" data-qty="${p.tiers[1] ? p.tiers[1].minQty : 10}">${p.tiers[1] ? p.tiers[1].minQty : 10} pcs</button>
                    <button type="button" class="preset-chip" data-action="card-qty-set" data-product-id="${p.id}" data-qty="${p.tiers[2] ? p.tiers[2].minQty : 25}">${p.tiers[2] ? p.tiers[2].minQty : 25} pcs</button>
                  </div>
                  <span class="card-line-subtotal">Total: ${formatPKR(lineSubtotal)}</span>
                </div>
              </div>

              <!-- Primary Add to Cart Button + Instant WhatsApp Button -->
              <div class="card-actions">
                <button
                  type="button"
                  class="btn-add-to-cart"
                  data-action="add-to-cart"
                  data-product-id="${p.id}"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="9" cy="21" r="1"></circle>
                    <circle cx="20" cy="21" r="1"></circle>
                    <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path>
                  </svg>
                  <span>Add to Cart</span>
                </button>
                <button
                  type="button"
                  class="btn-card-wa-instant"
                  data-action="direct-wa"
                  data-product-id="${p.id}"
                  title="Order this product directly on WhatsApp"
                >
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91C2.13 13.66 2.59 15.36 3.45 16.86L2.05 22L7.3 20.62C8.75 21.41 10.38 21.83 12.04 21.83C17.5 21.83 21.95 17.38 21.95 11.92C21.95 9.27 20.92 6.78 19.05 4.91C17.18 3.03 14.69 2 12.04 2ZM12.05 20.16C10.57 20.16 9.11 19.76 7.85 19L7.55 18.83L4.43 19.65L5.26 16.61L5.06 16.29C4.24 14.98 3.8 13.47 3.8 11.91C3.81 7.37 7.5 3.67 12.05 3.67C14.25 3.67 16.32 4.53 17.87 6.09C19.42 7.65 20.28 9.72 20.28 11.92C20.28 16.46 16.58 20.16 12.05 20.16ZM16.56 13.99C16.31 13.87 15.09 13.27 14.87 13.18C14.64 13.1 14.48 13.06 14.31 13.3C14.15 13.55 13.67 14.11 13.53 14.27C13.38 14.44 13.24 14.46 12.99 14.34C12.74 14.21 11.94 13.95 11 13.11C10.26 12.45 9.77 11.64 9.62 11.39C9.48 11.15 9.6 11.01 9.73 10.89C9.84 10.78 9.98 10.6 10.1 10.46C10.22 10.31 10.27 10.21 10.35 10.04C10.43 9.88 10.39 9.73 10.33 9.61C10.27 9.49 9.77 8.26 9.57 7.77C9.37 7.29 9.16 7.35 9.01 7.35C8.86 7.34 8.7 7.34 8.53 7.34C8.37 7.34 8.1 7.4 7.87 7.65C7.65 7.9 7.01 8.49 7.01 9.73C7.01 10.96 7.9 12.16 8.02 12.32C8.14 12.49 9.77 14.99 12.25 16.06C12.84 16.32 13.3 16.47 13.66 16.58C14.25 16.77 14.79 16.74 15.22 16.68C15.7 16.61 16.69 16.08 16.89 15.5C17.1 14.92 17.1 14.43 17.04 14.32C16.97 14.22 16.81 14.12 16.56 13.99Z"/>
                  </svg>
                  <span>Buy</span>
                </button>
              </div>
            </div>
          </article>
        `;
      })
      .join("");
  }

  // Render Header Badges, Cart Drawer, and Floating Cart Bar
  function renderCartUI() {
    const metrics = getCartMetrics();

    // Update header badge
    const headerCount = document.getElementById("headerCartCount");
    const headerTotal = document.getElementById("headerCartTotal");
    if (headerCount) headerCount.textContent = metrics.totalUnits;
    if (headerTotal) headerTotal.textContent = formatPKR(metrics.subtotal);

    // Update utility bar phone display
    const phoneBadge = document.getElementById("utilityPhoneDisplay");
    if (phoneBadge) phoneBadge.textContent = state.storePhone;

    const drawerPhoneInput = document.getElementById("drawerWaPhoneInput");
    if (drawerPhoneInput && document.activeElement !== drawerPhoneInput) {
      drawerPhoneInput.value = state.storePhone;
    }

    // Update Floating Bottom Bar
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

    // Render Cart Drawer Body
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
                <span>SKU: ${item.sku}</span>
                <span>Color: ${item.color}</span>
                <span>Size: ${item.size}</span>
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
          <span>Your Shop / Delivery Info (Optional)</span>
          <span style="font-weight: 600; font-size: 0.72rem; color: var(--text-muted);">Included in WhatsApp Msg</span>
        </div>
        <div class="buyer-form-grid">
          <input
            type="text"
            id="buyerNameInput"
            class="buyer-input"
            placeholder="Your Name / Shop Name"
            value="${escapeHtml(state.buyer.name)}"
          />
          <input
            type="text"
            id="buyerCityInput"
            class="buyer-input"
            placeholder="City (e.g. Lahore, Karachi)"
            value="${escapeHtml(state.buyer.city)}"
          />
          <input
            type="text"
            id="buyerNotesInput"
            class="buyer-input full-width"
            placeholder="Delivery Address or Special Wholesale Instructions..."
            value="${escapeHtml(state.buyer.notes)}"
          />
        </div>
      </div>

      <!-- Live Pre-Written WhatsApp Message Preview -->
      <div class="wa-preview-box">
        <div class="wa-preview-header">
          <span>📋 Pre-Written WhatsApp Order Message Preview</span>
          <button type="button" class="btn-copy-msg" id="btnCopyWaMessage">Copy Text</button>
        </div>
        <pre class="wa-preview-text" id="waLivePreviewText">${escapeHtml(waPreviewMessage)}</pre>
      </div>
    `;

    // Bind buyer input events inside drawer without losing focus
    const nameInp = document.getElementById("buyerNameInput");
    const cityInp = document.getElementById("buyerCityInput");
    const notesInp = document.getElementById("buyerNotesInput");
    const previewEl = document.getElementById("waLivePreviewText");

    function handleBuyerFieldChange() {
      state.buyer.name = nameInp ? nameInp.value : "";
      state.buyer.city = cityInp ? cityInp.value : "";
      state.buyer.notes = notesInp ? notesInp.value : "";
      saveBuyerInfo();
      if (previewEl) {
        previewEl.textContent = buildWhatsAppCartMessage(state.cart);
      }
    }

    if (nameInp) nameInp.addEventListener("input", handleBuyerFieldChange);
    if (cityInp) cityInp.addEventListener("input", handleBuyerFieldChange);
    if (notesInp) notesInp.addEventListener("input", handleBuyerFieldChange);

    const copyBtn = document.getElementById("btnCopyWaMessage");
    if (copyBtn) {
      copyBtn.addEventListener("click", () => {
        const msg = buildWhatsAppCartMessage(state.cart);
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(msg);
        }
        copyBtn.textContent = "✓ Copied!";
        setTimeout(() => {
          copyBtn.textContent = "Copy Text";
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

  // Quick View Modal
  function openQuickView(productId) {
    const product = products.find((p) => p.id === productId);
    if (!product) return;
    state.quickViewProductId = productId;

    const modalBackdrop = document.getElementById("quickViewBackdrop");
    const modalContent = document.getElementById("quickViewContainer");
    if (!modalBackdrop || !modalContent) return;

    const sel = state.cardSelections[product.id];
    const unitPrice = getUnitPriceForQty(product, sel.qty);
    const lineTotal = unitPrice * sel.qty;

    const tiersRows = product.tiers
      .map(
        (t) => `
        <div style="display:flex; justify-content:space-between; padding:6px 10px; background:#FFFFFF; border:1px solid var(--border-subtle); border-radius:6px; font-size:0.82rem;">
          <span style="font-weight:700;">${t.label}</span>
          <span class="tabular-nums" style="font-weight:800; color:var(--green-700);">${formatPKR(t.price)} / ${product.unitLabel}</span>
        </div>
      `
      )
      .join("");

    modalContent.innerHTML = `
      <div class="quickview-grid">
        <div class="quickview-media">
          <img src="${product.image}" alt="${product.name}" />
        </div>
        <div class="quickview-content">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <span class="badge-pill badge-emerald">${product.categoryLabel} • ${product.sku}</span>
            <button type="button" id="btnCloseQuickView" style="font-size:1.3rem; font-weight:800; color:var(--text-secondary); padding:4px 10px;">✕</button>
          </div>
          <h2 style="font-family:var(--font-display); font-size:1.5rem; line-height:1.2;">${product.name}</h2>
          <p style="font-size:0.9rem; color:var(--text-secondary);">${product.description}</p>
          <div style="font-size:0.83rem; background:var(--green-50); padding:10px 12px; border-radius:8px; border:1px solid var(--border-strong);">
            <strong>Fabric & Specification:</strong> ${product.fabric}
          </div>

          <div style="display:flex; flex-direction:column; gap:6px; background:var(--bg-secondary); padding:12px; border-radius:10px; border:1px solid var(--border-subtle);">
            <div style="font-size:0.78rem; font-weight:800; text-transform:uppercase; color:var(--text-secondary);">Wholesale Volume Price Tiers</div>
            ${tiersRows}
          </div>

          <div style="display:flex; align-items:center; justify-content:space-between; padding:12px; background:var(--green-50); border-radius:10px; border:1px solid var(--border-strong);">
            <div>
              <div style="font-size:0.76rem; font-weight:700; color:var(--text-secondary);">Selected Quantity: ${sel.qty} ${product.unitLabelPlural}</div>
              <div class="tabular-nums" style="font-size:1.25rem; font-weight:800; color:var(--green-800);">${formatPKR(lineTotal)}</div>
            </div>
            <div style="display:flex; gap:8px;">
              <button type="button" class="btn-primary-emerald" id="btnQuickViewAddCart" style="padding:11px 18px; font-size:0.88rem;">
                Add to Cart
              </button>
              <button type="button" class="btn-card-wa-instant" id="btnQuickViewDirectWa" style="padding:11px 16px; font-size:0.88rem;">
                Buy on WhatsApp
              </button>
            </div>
          </div>
        </div>
      </div>
    `;

    modalBackdrop.classList.add("open");

    const closeBtn = document.getElementById("btnCloseQuickView");
    if (closeBtn) {
      closeBtn.addEventListener("click", closeQuickView);
    }

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
          ? `<button type="button" style="background:#4ADE80; color:#042214; font-weight:800; font-size:0.76rem; padding:5px 10px; border-radius:99px; white-space:nowrap;" class="toast-open-cart-btn">Go to Cart →</button>`
          : ""
      }
      ${
        optionalWaUrl
          ? `<a href="${optionalWaUrl}" target="_blank" rel="noopener noreferrer" style="background:#25D366; color:#FFFFFF; font-weight:800; font-size:0.76rem; padding:5px 10px; border-radius:99px; text-decoration:none; white-space:nowrap;">Open WhatsApp ↗</a>`
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
    }, 4500);
  }

  function renderAll() {
    renderCategoryTabs();
    renderProductGrid();
    renderCartUI();
  }

  // Event Listeners Setup
  function setupEventListeners() {
    // Sticky header shadow on scroll
    window.addEventListener("scroll", () => {
      const header = document.getElementById("siteHeader");
      if (header) {
        if (window.scrollY > 12) {
          header.classList.add("scrolled");
        } else {
          header.classList.remove("scrolled");
        }
      }
    });

    // Category Tab Clicks
    const catTabs = document.getElementById("categoryTabs");
    if (catTabs) {
      catTabs.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-cat]");
        if (!btn) return;
        state.activeCategory = btn.getAttribute("data-cat");
        renderAll();
      });
    }

    // Search Input
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

    // Sort Select
    const sortSelect = document.getElementById("catalogSortSelect");
    if (sortSelect) {
      sortSelect.addEventListener("change", (e) => {
        state.sortBy = e.target.value;
        renderProductGrid();
      });
    }

    // Product Grid Delegated Actions
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

        if (action === "select-color") {
          sel.color = actionEl.getAttribute("data-color");
          renderProductGrid();
        } else if (action === "card-qty-dec") {
          sel.qty = Math.max(1, sel.qty - 1);
          renderProductGrid();
        } else if (action === "card-qty-inc") {
          sel.qty = sel.qty + 1;
          renderProductGrid();
        } else if (action === "card-qty-set") {
          const presetQty = parseInt(actionEl.getAttribute("data-qty"), 10);
          if (presetQty > 0) {
            sel.qty = presetQty;
            renderProductGrid();
          }
        } else if (action === "add-to-cart") {
          addToCart(productId, sel.qty, sel.size, sel.color, false);
        } else if (action === "direct-wa") {
          // Single-product immediate WhatsApp redirect with pre-written message
          const singleMsg = buildWhatsAppCartMessage([
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
          redirectToWhatsApp(singleMsg);
        } else if (action === "quick-view") {
          openQuickView(productId);
        }
      });

      productGrid.addEventListener("change", (e) => {
        const target = e.target;
        const action = target.getAttribute("data-action");
        const productId = target.getAttribute("data-product-id");
        if (!action || !productId || !state.cardSelections[productId]) return;

        if (action === "select-size") {
          state.cardSelections[productId].size = target.value;
        } else if (action === "card-qty-input") {
          const val = Math.max(1, parseInt(target.value, 10) || 1);
          state.cardSelections[productId].qty = val;
          renderProductGrid();
        }
      });
    }

    // Header & Floating Cart Triggers
    const btnOpenCart = document.getElementById("btnHeaderCart");
    const btnFloatingCart = document.getElementById("btnFloatingOpenCart");
    const btnCloseCart = document.getElementById("btnCloseCartDrawer");
    const cartBackdrop = document.getElementById("cartDrawerBackdrop");

    if (btnOpenCart) btnOpenCart.addEventListener("click", openCartDrawer);
    if (btnFloatingCart) btnFloatingCart.addEventListener("click", openCartDrawer);
    if (btnCloseCart) btnCloseCart.addEventListener("click", closeCartDrawer);
    if (cartBackdrop) cartBackdrop.addEventListener("click", closeCartDrawer);

    // Direct WhatsApp Inquiry in Header
    const btnDirectWaHeader = document.getElementById("btnDirectWaHeader");
    if (btnDirectWaHeader) {
      btnDirectWaHeader.addEventListener("click", () => {
        if (state.cart.length > 0) {
          openCartDrawer();
        } else {
          const msg = buildWhatsAppCartMessage([]);
          redirectToWhatsApp(msg);
        }
      });
    }

    // Utility Bar Configure Store WhatsApp Button
    const btnConfigWaTop = document.getElementById("btnConfigWaTop");
    if (btnConfigWaTop) {
      btnConfigWaTop.addEventListener("click", () => {
        openCartDrawer();
        setTimeout(() => {
          const input = document.getElementById("drawerWaPhoneInput");
          if (input) {
            input.focus();
            input.select();
          }
        }, 250);
      });
    }

    // Store WhatsApp Phone Input inside Cart Drawer
    const drawerWaPhoneInput = document.getElementById("drawerWaPhoneInput");
    if (drawerWaPhoneInput) {
      drawerWaPhoneInput.addEventListener("input", (e) => {
        state.storePhone = e.target.value.trim() || DEFAULT_WA_PHONE;
        localStorage.setItem(STORAGE_PHONE_KEY, state.storePhone);
        const phoneBadge = document.getElementById("utilityPhoneDisplay");
        if (phoneBadge) phoneBadge.textContent = state.storePhone;
      });
    }

    // Cart Drawer Delegated Item Controls
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

    // Clear Cart Button
    const btnClearCart = document.getElementById("btnClearCart");
    if (btnClearCart) {
      btnClearCart.addEventListener("click", () => {
        clearCart();
      });
    }

    // Primary Cart "Click to Buy on WhatsApp" Button
    const btnWhatsappCheckout = document.getElementById("btnWhatsappCheckout");
    if (btnWhatsappCheckout) {
      btnWhatsappCheckout.addEventListener("click", () => {
        if (!state.cart.length) return;
        const msg = buildWhatsAppCartMessage(state.cart);
        redirectToWhatsApp(msg);
      });
    }

    // Floating Bar Direct Buy on WhatsApp Button
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

    // Quick View Backdrop Close
    const quickViewBackdrop = document.getElementById("quickViewBackdrop");
    if (quickViewBackdrop) {
      quickViewBackdrop.addEventListener("click", (e) => {
        if (e.target === quickViewBackdrop) {
          closeQuickView();
        }
      });
    }

    // Escape key closes modals/drawers
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        closeQuickView();
        closeCartDrawer();
      }
    });
  }

  // Initialize on DOMContentLoaded
  document.addEventListener("DOMContentLoaded", () => {
    renderAll();
    setupEventListeners();
  });
})();
