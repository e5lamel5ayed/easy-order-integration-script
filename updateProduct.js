const axios = require("axios");
require('dotenv').config();

// ======================= CONFIGURATION =======================
const ERP_API_URL = process.env.ERP_API_URL;
const EASY_ORDER_BASE_URL = process.env.EASY_ORDER_BASE_URL;
const EASY_ORDER_API_KEY = process.env.EASY_ORDER_API_KEY;

// ======================= HELPER FUNCTIONS =======================

async function fetchERPProducts() {
    try {
        const response = await axios.get(ERP_API_URL);
        return response.data.data || [];
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

            if (!Array.isArray(products) || products.length === 0) {
                console.log("✅ No more products to fetch.");
                break;
            }

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


async function updateEasyOrderProduct(productId, variantsData) {
    try {
        const response = await axios.get(
            `${EASY_ORDER_BASE_URL}/products/${productId}`,
            { headers: { "Api-Key": EASY_ORDER_API_KEY } }
        );
        const product = response.data;

        if (product.variants && variantsData.length > 0) {
            let hasChanges = false;
            variantsData.forEach(update => {
                const variant = product.variants.find(v => v.id === update.id);
                if (variant) {
                    variant.quantity = update.quantity;
                    hasChanges = true;
                }
            });

            if (!hasChanges) return;
        }

        // 3. إرسال التحديث
        await axios.patch(
            `${EASY_ORDER_BASE_URL}/products/${productId}`,
            product,
            {
                headers: {
                    "Api-Key": EASY_ORDER_API_KEY,
                    "Content-Type": "application/json"
                },
            }
        );

        console.log(`✅ Successfully updated product: ${product.name}`);
    } catch (err) {
        console.error(`❌ Failed to update product ${productId}:`, err.response?.data?.message || err.message);
    }
}

// ======================= MAIN SYNC FUNCTION =======================

async function syncProducts() {
    console.log("🚀 Starting synchronization process...");

    const erpProducts = await fetchERPProducts();
    console.log(`📦 Fetched ${erpProducts.length} products from ERP`);

    const easyProducts = await fetchEasyOrderProducts();
    console.log(`📦 Fetched ${easyProducts.length} products from Easy Order`);

    if (erpProducts.length === 0 || easyProducts.length === 0) {
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

                const matchingEasyVariant = easyProduct.variants.find(ev => ev.taager_code === targetCode);

                if (matchingEasyVariant) {
                    const newQuantity = parseInt(erpVariant.quantity);
                    const currentQuantity = parseInt(matchingEasyVariant.quantity);

                    if (newQuantity !== currentQuantity) {
                        if (!updatesMap[easyProduct.id]) {
                            updatesMap[easyProduct.id] = [];
                        }

                        updatesMap[easyProduct.id].push({
                            id: matchingEasyVariant.id,
                            quantity: newQuantity
                        });
                    }
                }
            }
        }
    }

    const productIdsToUpdate = Object.keys(updatesMap);
    console.log(`🔍 Found differences in ${productIdsToUpdate.length} products based on code matching.`);

    let updatedCount = 0;
    for (const productId of productIdsToUpdate) {
        console.log(`🔄 Sending updates for Product ID: ${productId} ...`);
        await updateEasyOrderProduct(productId, updatesMap[productId]);
        updatedCount++;
    }

    console.log(`🏁 Sync complete. Updated ${updatedCount} products.`);
}

// ======================= RUN =======================
const SYNC_INTERVAL = 20000;

async function runContinuousSync() {
    console.log(`⏰ Starting continuous sync (every ${SYNC_INTERVAL / 1000} seconds)...`);
    
    while (true) {
        try {
            await syncProducts();
        } catch (error) {
            console.error("❌ Error during sync:", error.message);
        }
        
        console.log(`⏳ Waiting ${SYNC_INTERVAL / 1000} seconds before next sync...\n`);
        await new Promise(resolve => setTimeout(resolve, SYNC_INTERVAL));
    }
}

runContinuousSync();
