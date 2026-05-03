const axios = require("axios");
require("dotenv").config();

// ======================= CONFIGURATION =======================
const ERP_API_URL = process.env.ERP_API_URL;
const EASY_ORDER_BASE_URL = process.env.EASY_ORDER_BASE_URL;
const EASY_ORDER_API_KEY = process.env.EASY_ORDER_API_KEY;

// ======================= HELPER FUNCTIONS =======================

async function fetchERPProducts() {
    try {
        const response = await axios.get(ERP_API_URL);
        return response.data?.data || [];
    } catch (error) {
        console.error("❌ Failed to fetch from ERP:", error.message);
        return [];
    }
}

async function fetchEasyOrderProducts() {
    try {
        console.log("⏳ Fetching ALL Easy Order products with pagination...");

        let allProducts = [];
        let page = 1;
        const limit = 20;

        while (true) {
            console.log(`📄 Fetching page ${page}...`);

            const response = await axios.get(
                `${EASY_ORDER_BASE_URL}/products`,
                {
                    params: {
                        page,
                        limit,
                        join: "Variations.Props,Variants.VariationProps"
                    },
                    headers: {
                        "Api-Key": EASY_ORDER_API_KEY,
                        "Accept": "application/json"
                    }
                }
            );

            const products = response.data?.data || [];
            if (!products.length) break;

            allProducts.push(...products);
            page++;
        }

        console.log(`📦 Total Easy Order products fetched: ${allProducts.length}`);
        return allProducts;

    } catch (error) {
        console.error(
            "❌ Failed to fetch from Easy Order:",
            error.response?.data || error.message
        );
        return [];
    } 
}

// ======================= UPDATE PRODUCT =======================

async function updateEasyOrderProduct(productId, variantsData, options = {}) {
    try {
        const { updateQuantity = true, updatePricing = true } = options;

        const response = await axios.get(
            `${EASY_ORDER_BASE_URL}/products/${productId}`,
            { headers: { "Api-Key": EASY_ORDER_API_KEY } }
        );

        const product = response.data;
        if (!product?.variants || !product.variants.length) return;

        let hasChanges = false;
        let quantityChangedFlag = false;

        // تحديث الـ variants اللي جاية من ERP
        if (variantsData?.length) {
            variantsData.forEach(update => {
                const variant = product.variants.find(v => v.id === update.id);
                if (!variant) return;

                if (updateQuantity) {
                    const newQty = Math.max(0, Number(update.quantity));

                    if (newQty !== Number(variant.quantity)) {
                        variant.quantity = newQty;
                        quantityChangedFlag = true;
                        hasChanges = true;
                    }
                }

                if (updatePricing) {
                    if (Number(update.price) !== Number(variant.price)) {
                        variant.price = Number(update.price);
                        hasChanges = true;
                    }

                    if (Number(update.sale_price) !== Number(variant.sale_price)) {
                        variant.sale_price = Number(update.sale_price);
                        hasChanges = true;
                    }

                    if (Number(update.expense) !== Number(variant.expense)) {
                        variant.expense = Number(update.expense);
                        hasChanges = true;
                    }
                }
            });
        }

        // ✅ نجمع كميات الـ variants فقط لو quantity اتغيرت
        if (quantityChangedFlag) {
            const totalQuantity = product.variants.reduce((sum, v) => {
                return sum + Math.max(0, Number(v.quantity || 0));
            }, 0);

            if (Number(product.quantity) !== totalQuantity) {
                product.quantity = totalQuantity;
                hasChanges = true;
            }
        }

        // تحديث سعر البرودكت الرئيسي من أول variant متطابق أثناء تسعير المنتج
        if (updatePricing && variantsData?.length) {
            const firstMatchedVariant = product.variants.find(v =>
                variantsData.some(u => u.id === v.id)
            );

            if (firstMatchedVariant) {
                const nextProductPrice = Number(firstMatchedVariant.price);
                const nextProductSalePrice = Number(firstMatchedVariant.sale_price);

                if (!Number.isNaN(nextProductPrice) && Number(product.price) !== nextProductPrice) {
                    product.price = nextProductPrice;
                    hasChanges = true;
                }

                if (
                    !Number.isNaN(nextProductSalePrice) &&
                    Number(product.sale_price) !== nextProductSalePrice
                ) {
                    product.sale_price = nextProductSalePrice;
                    hasChanges = true;
                }
            }
        }

        if (!hasChanges) {
            console.log(`⏭️ No changes for product ${productId}`);
            return;
        }

        await axios.patch(
            `${EASY_ORDER_BASE_URL}/products/${productId}`,
            product,
            {
                headers: {
                    "Api-Key": EASY_ORDER_API_KEY,
                    "Content-Type": "application/json"
                }
            }
        );

        console.log(
            `✅ Updated product ${productId}` +
            (quantityChangedFlag ? " | Quantity recalculated" : "")
        );

    } catch (err) {
        console.error(
            `❌ Failed to update product ${productId}:`,
            err.response?.data || err.message
        );
    }
}

// ======================= MAIN SYNC FUNCTION =======================

async function syncProducts(mode = "all") {
    const shouldSyncQuantity = mode === "all" || mode === "quantity";
    const shouldSyncPricing = mode === "all" || mode === "pricing";

    console.log(`🚀 Starting ${mode} synchronization process...`);

    const erpProducts = await fetchERPProducts();
    const easyProducts = await fetchEasyOrderProducts();

    if (!erpProducts.length || !easyProducts.length) {
        console.log("⚠️ Not enough data to compare.");
        return;
    }

    const updatesMap = {};

    for (const erpProduct of erpProducts) {
        if (!erpProduct.variants) continue;

        for (const erpVariant of erpProduct.variants) {
            const targetCode = erpVariant.slug;
            if (!targetCode) continue;

            for (const easyProduct of easyProducts) {
                if (!easyProduct.variants) continue;

                const matchingEasyVariant = easyProduct.variants.find(
                    ev => ev.taager_code === targetCode
                );

                if (!matchingEasyVariant) continue;

                const erpQuantity = Math.max(0, Number(erpVariant.quantity));
                const erpPrice    = Number(erpVariant.price);
                const erpSalePrice = Number(erpVariant.sale_price);
                const erpExpense  = Number(erpVariant.expense);

                const quantityChanged =
                    shouldSyncQuantity &&
                    erpQuantity !== Number(matchingEasyVariant.quantity);

                const priceChanged =
                    shouldSyncPricing &&
                    erpPrice !== Number(matchingEasyVariant.price);

                const salePriceChanged =
                    shouldSyncPricing &&
                    erpSalePrice !== Number(matchingEasyVariant.sale_price);

                const expenseChanged =
                    shouldSyncPricing &&
                    erpExpense !== Number(matchingEasyVariant.expense);

                if (quantityChanged || priceChanged || salePriceChanged || expenseChanged) {
                    if (!updatesMap[easyProduct.id]) {
                        updatesMap[easyProduct.id] = [];
                    }

                    updatesMap[easyProduct.id].push({
                        id: matchingEasyVariant.id,
                        price: erpPrice,
                        quantity: erpQuantity,
                        sale_price: erpSalePrice,
                        expense: erpExpense
                    });
                }
            }
        }
    }

    const productIdsToUpdate = Object.keys(updatesMap);
    console.log(`🔍 Found differences in ${productIdsToUpdate.length} products.`);

    for (const productId of productIdsToUpdate) {
        await updateEasyOrderProduct(productId, updatesMap[productId], {
            updateQuantity: shouldSyncQuantity,
            updatePricing: shouldSyncPricing
        });
    }

    console.log(`🏁 ${mode} sync complete.`);
}
// ======================= RUN =======================

function getMsUntilNextMidnight() {
    const now = new Date();
    const nextMidnight = new Date(now);
    nextMidnight.setDate(now.getDate() + 1);
    nextMidnight.setHours(0, 0, 0, 0);
    return nextMidnight - now;
}

function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function runQuantitySyncAtMidnight() {
    console.log("⏰ Quantity sync scheduled once at start of each day (midnight)");

    // wait until the next midnight, then run daily
    await wait(getMsUntilNextMidnight());

    while (true) {
        try {
            await syncProducts("quantity");
        } catch (error) {
            console.error("❌ Quantity sync error:", error.message);
        }

        // wait 24 hours until next run
        await wait(24 * 60 * 60 * 1000);
    }
}

async function runPricingSyncEveryMinute() {
    console.log("💲 Pricing sync scheduled every 60 seconds");

    while (true) {
        try {
            await syncProducts("pricing");
        } catch (error) {
            console.error("❌ Pricing sync error:", error.message);
        }

        await wait(60 * 1000);
    }
}

Promise.all([
    runQuantitySyncAtMidnight(),
    runPricingSyncEveryMinute()
]).catch(error => {
    console.error("❌ Scheduler error:", error.message);
});
