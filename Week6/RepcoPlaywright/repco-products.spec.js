// repco-products.spec.js
// Playwright test — list all offers & product details from Repco category page
//
// Setup:
//   npm init -y
//   npm install -D @playwright/test
//   npx playwright install chromium
//   npx playwright test repco-products.spec.js --reporter=list
//
// Output:  repco_products.json  (written to project root)

const { test, expect } = require("@playwright/test");
const fs = require("fs");
const path = require("path");

// ─── Config ────────────────────────────────────────────────────────────────
const TARGET_URL =
  "https://www.repco.com.au/parts-service/c/1862918091";

const OUTPUT_FILE = path.join(__dirname, "repco_products.json");

// How long to wait for the product grid to appear (ms)
const GRID_TIMEOUT = 20_000;

// Max pages to paginate through (safety cap — raise if needed)
const MAX_PAGES = 50;

// ─── Selector candidates — tried in order until one matches ────────────────
// Repco runs on SAP Spartacus; class names can change between deployments.
// The helper below walks these arrays and returns the first live selector.
const GRID_CANDIDATES = [
  "cx-product-list-item",           // Spartacus component tag
  ".product-list-item",
  "[class*='product-list'] li",
  "[class*='ProductListItem']",
  ".product-item",
  "app-product-list-item",
  "[data-testid='product-item']",
];

const FIELD_SELECTORS = {
  name: [
    "cx-product-item-name",
    ".cx-product-name",
    ".product-name",
    "[class*='ProductName']",
    "h3",
    "h2.name",
    "[data-testid='product-name']",
  ],
  price: [
    ".cx-product-price .value",
    "cx-product-price",
    ".price",
    "[class*='price']",
    "[data-testid='product-price']",
    ".product-price",
  ],
  originalPrice: [
    ".cx-product-price del",
    ".was-price",
    ".original-price",
    "s.price",
    "[class*='wasPrice']",
  ],
  badge: [
    ".cx-product-badge",
    ".badge",
    "[class*='badge']",
    "[class*='Badge']",
    "[class*='tag']",
    "[data-testid='badge']",
  ],
  sku: [
    "[class*='code']",
    ".product-code",
    ".sku",
    "[data-testid='sku']",
    ".partNumber",
  ],
  brand: [
    ".cx-product-brand",
    "[class*='brand']",
    "[class*='Brand']",
    "[data-testid='brand']",
  ],
  rating: [
    "cx-star-rating",
    ".cx-rating",
    "[aria-label*='stars']",
    "[aria-label*='rating']",
    "[class*='rating']",
  ],
  image: [
    "cx-media img",
    ".cx-product-image img",
    ".product-image img",
    "[class*='ProductImage'] img",
    "img.product-img",
    "img",                           // last-resort
  ],
  link: [
    "a.cx-product-name",
    "a[href*='/p/']",
    "a[href*='/product/']",
    "a.product-link",
    "a",
  ],
  offer: [
    "[class*='promo']",
    "[class*='Promo']",
    "[class*='offer']",
    "[class*='discount']",
    ".cx-promotional-text",
    "[data-testid='promo']",
  ],
};

const NEXT_PAGE_CANDIDATES = [
  "[aria-label='Next page']",
  "[aria-label='next']",
  "cx-pagination .btn-action-submit:not([disabled])",
  ".pagination .next:not(.disabled) a",
  "button[aria-label*='next']",
  "[class*='paginationNext']:not([disabled])",
  "a[rel='next']",
];

const COOKIE_BANNER_CANDIDATES = [
  "#onetrust-accept-btn-handler",
  "[id*='cookie'] button[class*='accept']",
  "button:has-text('Accept All')",
  "button:has-text('Accept Cookies')",
  "button:has-text('Got It')",
  "[aria-label*='Accept cookies']",
];

// ─── Helpers ───────────────────────────────────────────────────────────────

/** Returns the first selector from `candidates` that matches at least one element */
async function findSelector(locator, candidates) {
  for (const sel of candidates) {
    try {
      const count = await locator.locator(sel).count();
      if (count > 0) return sel;
    } catch {
      // invalid selector — skip
    }
  }
  return null;
}

/** Safely extract text from the first matching candidate inside `parent` */
async function extractText(parent, candidates) {
  for (const sel of candidates) {
    try {
      const el = parent.locator(sel).first();
      const count = await el.count();
      if (count > 0) {
        const txt = (await el.innerText()).trim();
        if (txt) return txt;
      }
    } catch {
      /* skip */
    }
  }
  return null;
}

/** Safely extract an attribute from the first matching candidate inside `parent` */
async function extractAttr(parent, candidates, attr) {
  for (const sel of candidates) {
    try {
      const el = parent.locator(sel).first();
      const count = await el.count();
      if (count > 0) {
        const val = await el.getAttribute(attr);
        if (val) return val.trim();
      }
    } catch {
      /* skip */
    }
  }
  return null;
}

/** Extract ALL badge / promo text inside a card */
async function extractAllText(parent, candidates) {
  for (const sel of candidates) {
    try {
      const els = parent.locator(sel);
      const count = await els.count();
      if (count > 0) {
        const results = [];
        for (let i = 0; i < count; i++) {
          const t = (await els.nth(i).innerText()).trim();
          if (t) results.push(t);
        }
        if (results.length) return results;
      }
    } catch {
      /* skip */
    }
  }
  return [];
}

// ─── Main test ─────────────────────────────────────────────────────────────

test.describe("Repco — parts & service category listing", () => {

  test("scrape all product details and offers", async ({ page }) => {

    // ── Step 1: Navigate ──────────────────────────────────────────
    console.log(`\nNavigating to: ${TARGET_URL}`);
    await page.goto(TARGET_URL, { waitUntil: "domcontentloaded", timeout: 30_000 });

    // ── Step 2: Dismiss cookie / consent banner ───────────────────
    for (const sel of COOKIE_BANNER_CANDIDATES) {
      try {
        const btn = page.locator(sel).first();
        if (await btn.isVisible({ timeout: 3_000 })) {
          await btn.click();
          console.log(`  Dismissed cookie banner via: ${sel}`);
          await page.waitForTimeout(800);
          break;
        }
      } catch {
        /* not present — continue */
      }
    }

    // ── Step 3: Wait for product grid ─────────────────────────────
    let gridSelector = null;
    for (const sel of GRID_CANDIDATES) {
      try {
        await page.waitForSelector(sel, { timeout: GRID_TIMEOUT });
        gridSelector = sel;
        console.log(`  Product grid selector resolved: "${sel}"`);
        break;
      } catch {
        /* try next */
      }
    }

    if (!gridSelector) {
      // Dump page HTML for debugging then fail clearly
      const snippet = (await page.content()).slice(0, 2000);
      console.error("Could not find product grid. Page snippet:\n", snippet);
      throw new Error(
        "No product grid found. The page structure may have changed — " +
        "update GRID_CANDIDATES with the correct selector."
      );
    }

    // ── Step 4: Scroll to trigger lazy-loaded images ──────────────
    await page.evaluate(() =>
      window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" })
    );
    await page.waitForTimeout(1_500);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
    await page.waitForTimeout(500);

    // ── Step 5: Paginate and collect all products ─────────────────
    const allProducts = [];
    let pageNum = 1;

    while (pageNum <= MAX_PAGES) {
      console.log(`\n  ── Page ${pageNum} ──`);

      // Wait for items on this page
      await page.waitForSelector(gridSelector, { timeout: GRID_TIMEOUT });

      const cards = page.locator(gridSelector);
      const count = await cards.count();
      console.log(`  Found ${count} product card(s) on page ${pageNum}`);

      for (let i = 0; i < count; i++) {
        const card = cards.nth(i);

        const name          = await extractText(card, FIELD_SELECTORS.name);
        const price         = await extractText(card, FIELD_SELECTORS.price);
        const originalPrice = await extractText(card, FIELD_SELECTORS.originalPrice);
        const sku           = await extractText(card, FIELD_SELECTORS.sku);
        const brand         = await extractText(card, FIELD_SELECTORS.brand);
        const rating        = await extractAttr(card, FIELD_SELECTORS.rating, "aria-label")
                             ?? await extractText(card, FIELD_SELECTORS.rating);
        const badges        = await extractAllText(card, FIELD_SELECTORS.badge);
        const offers        = await extractAllText(card, FIELD_SELECTORS.offer);
        const imageUrl      = await extractAttr(card, FIELD_SELECTORS.image, "src")
                             ?? await extractAttr(card, FIELD_SELECTORS.image, "data-src");
        const productUrl    = await extractAttr(card, FIELD_SELECTORS.link, "href");

        const isOnSale = !!(originalPrice && price && originalPrice !== price);

        const product = {
          page:          pageNum,
          index:         i + 1,
          name:          name          ?? "—",
          brand:         brand         ?? "—",
          sku:           sku           ?? "—",
          price:         price         ?? "—",
          originalPrice: originalPrice ?? null,
          isOnSale,
          discount:      isOnSale ? `${originalPrice} → ${price}` : null,
          badges:        badges.length  ? badges  : [],
          offers:        offers.length  ? offers  : [],
          rating:        rating         ?? null,
          imageUrl:      imageUrl       ?? null,
          productUrl:    productUrl
                           ? new URL(productUrl, TARGET_URL).href
                           : null,
        };

        allProducts.push(product);

        // Live console output
        const saleFlag = isOnSale ? " [SALE]" : "";
        const badgeStr = badges.length  ? ` | badges: ${badges.join(", ")}` : "";
        const offerStr = offers.length  ? ` | offers: ${offers.join(", ")}` : "";
        console.log(
          `    [${i + 1}] ${product.name} | ${product.price}${saleFlag}${badgeStr}${offerStr}`
        );
      }

      // ── Step 6: Try to go to next page ──────────────────────────
      let advanced = false;

      for (const sel of NEXT_PAGE_CANDIDATES) {
        try {
          const btn = page.locator(sel).first();
          if (await btn.isVisible({ timeout: 2_000 })) {
            const isDisabled = await btn.isDisabled();
            if (!isDisabled) {
              await btn.click();
              // Wait for URL or grid to update
              await Promise.race([
                page.waitForURL(/[?&]page=\d+/, { timeout: 8_000 }),
                page.waitForFunction(
                  (prev) => {
                    const el = document.querySelector("cx-pagination .page-count, .page-count, [class*='pageNumber']");
                    return el ? el.textContent !== prev : false;
                  },
                  `${pageNum}`,
                  { timeout: 8_000 }
                ),
                page.waitForTimeout(3_000),
              ]).catch(() => {});
              await page.waitForTimeout(1_000);
              advanced = true;
              pageNum++;
              break;
            }
          }
        } catch {
          /* selector not present — try next */
        }
      }

      if (!advanced) {
        console.log(`\n  No more pages found — stopping after page ${pageNum}.`);
        break;
      }
    }

    // ── Step 7: Summary assertions ────────────────────────────────
    console.log(`\n${"─".repeat(60)}`);
    console.log(`Total products collected : ${allProducts.length}`);
    console.log(`Products on sale         : ${allProducts.filter(p => p.isOnSale).length}`);
    console.log(`Products with badges     : ${allProducts.filter(p => p.badges.length).length}`);
    console.log(`Products with offers     : ${allProducts.filter(p => p.offers.length).length}`);
    console.log(`${"─".repeat(60)}\n`);

    expect(allProducts.length).toBeGreaterThan(0);

    // ── Step 8: Write JSON output ─────────────────────────────────
    const report = {
      url:         TARGET_URL,
      scrapedAt:   new Date().toISOString(),
      totalPages:  pageNum,
      totalItems:  allProducts.length,
      onSaleCount: allProducts.filter(p => p.isOnSale).length,
      products:    allProducts,
    };

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(report, null, 2), "utf-8");
    console.log(`Results written to: ${OUTPUT_FILE}`);
  });

});
