const XLSX = require("xlsx");
const path = require("path");
const fs = require("fs");

const CATALOG_FILE = "/sessions/jolly-happy-carson/mnt/Abel Lumber/Abel_Catalog_CLEAN.xlsx";

function readExcelSheet(filePath) {
  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    return [];
  }

  const wb = XLSX.readFile(filePath);
  // Use the correct sheet name
  const ws = wb.Sheets["Product Master — Clean"] || wb.Sheets[wb.SheetNames[0]];

  if (!ws) {
    console.error(`Unable to find sheet. Available: ${wb.SheetNames.join(", ")}`);
    return [];
  }

  const data = XLSX.utils.sheet_to_json(ws, { defval: null });
  return data;
}

function normalizeProduct(row) {
  // Excel columns vary - we'll look for common names
  const getValue = (row, names) => {
    for (const name of names) {
      if (name in row && row[name] !== null && row[name] !== undefined) {
        return row[name];
      }
    }
    return null;
  };

  return {
    name: getValue(row, ["Product Name", "Name", "Product", "Description"]) || "",
    sku: getValue(row, ["SKU", "Sku", "sku", "Product Code"]) || "",
    description: getValue(row, ["Description", "Desc", "Long Description"]) || "",
    category: getValue(row, ["Category", "category", "Type"]) || "",
    subcategory: getValue(row, ["SubCategory", "Subcategory", "subcategory", "Subtype"]) || "",
    basePrice: parseFloat(getValue(row, ["BasePrice", "Base Price", "Price", "Retail Price"]) || 0) || 0,
    cost: parseFloat(getValue(row, ["Cost", "cost", "Unit Cost"]) || 0) || 0,
    doorSize: getValue(row, ["DoorSize", "Door Size", "doorSize", "Size"]) || "",
    handing: getValue(row, ["Handing", "handing", "Hand"]) || "",
    coreType: getValue(row, ["CoreType", "Core Type", "coreType", "Core"]) || "",
    panelStyle: getValue(row, ["PanelStyle", "Panel Style", "panelStyle", "Style"]) || "",
    jambSize: getValue(row, ["JambSize", "Jamb Size", "jambSize"]) || "",
    casingCode: getValue(row, ["CasingCode", "Casing Code", "casingCode"]) || "",
    hardwareFinish: getValue(row, ["HardwareFinish", "Hardware Finish", "hardwareFinish"]) || "",
    material: getValue(row, ["Material", "material"]) || "",
    fireRating: getValue(row, ["FireRating", "Fire Rating", "fireRating"]) || "",
  };
}

function auditProducts() {
  console.log("╔════════════════════════════════════════════════════════════╗");
  console.log("║    ABEL BUILDER PLATFORM - PRODUCT CATALOG AUDIT REPORT    ║");
  console.log("║                 (From Excel Source Files)                  ║");
  console.log("╚════════════════════════════════════════════════════════════╝\n");

  console.log(`Reading from ${path.basename(CATALOG_FILE)}...`);
  let allProducts = readExcelSheet(CATALOG_FILE);

  if (allProducts.length === 0) {
    console.error("No products found!");
    return;
  }

  // Log column names for debugging
  console.log(`\nFirst row columns: ${Object.keys(allProducts[0]).slice(0, 10).join(", ")}...\n`);

  allProducts = allProducts.map(normalizeProduct);

  const totalProducts = allProducts.length;
  console.log(`\n📊 1. TOTAL PRODUCT COUNT: ${totalProducts}`);

  // 2. PRODUCTS PER CATEGORY
  console.log(`\n📁 2. PRODUCTS PER CATEGORY:`);
  const categoryCounts = {};
  allProducts.forEach((product) => {
    const cat = product.category || "NULL";
    categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
  });

  Object.entries(categoryCounts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 20)
    .forEach(([category, count]) => {
      const percentage = ((count / totalProducts) * 100).toFixed(2);
      console.log(`   ${category}: ${count} (${percentage}%)`);
    });

  if (Object.keys(categoryCounts).length > 20) {
    console.log(`   ... and ${Object.keys(categoryCounts).length - 20} more categories`);
  }

  // 3. ATTRIBUTE COVERAGE ANALYSIS
  console.log(`\n🔍 3. ATTRIBUTE COVERAGE ANALYSIS:`);
  const attributes = [
    "sku",
    "description",
    "basePrice",
    "cost",
    "doorSize",
    "handing",
    "coreType",
    "panelStyle",
    "jambSize",
    "casingCode",
    "hardwareFinish",
    "material",
    "fireRating",
    "subcategory",
  ];

  attributes.forEach((attr) => {
    let filledCount = 0;

    allProducts.forEach((product) => {
      const value = product[attr];

      // Special handling for numeric attributes
      if (attr === "basePrice" || attr === "cost") {
        if (typeof value === "number" && value > 0) {
          filledCount++;
        }
      } else if (value !== null && value !== undefined && value !== "") {
        filledCount++;
      }
    });

    const percentage = (
      (filledCount / totalProducts) *
      100
    ).toFixed(2);

    console.log(
      `   ${attr.padEnd(18)}: ${String(filledCount).padStart(5)} (${String(percentage).padStart(5)}%)`
    );
  });

  // 4. DUPLICATE ANALYSIS
  console.log(`\n🔄 4. DUPLICATE ANALYSIS:`);

  // Exact duplicates
  const nameGroups = {};
  allProducts.forEach((product, idx) => {
    const name = product.name;
    if (!nameGroups[name]) {
      nameGroups[name] = [];
    }
    nameGroups[name].push(idx);
  });

  const exactDuplicates = Object.entries(nameGroups)
    .filter(([, ids]) => ids.length > 1)
    .map(([name, ids]) => ({ name, count: ids.length }))
    .sort((a, b) => b.count - a.count);

  console.log(`   Exact Name Duplicates: ${exactDuplicates.length} groups`);
  if (exactDuplicates.length > 0) {
    exactDuplicates.slice(0, 5).forEach(({ name, count }) => {
      console.log(`      "${name}": ${count} products`);
    });
    if (exactDuplicates.length > 5) {
      console.log(
        `      ... and ${exactDuplicates.length - 5} more groups`
      );
    }
  }

  // Similar duplicates (first 30 chars match)
  const similarGroups = {};
  allProducts.forEach((product, idx) => {
    const key = product.name.substring(0, 30);
    if (!similarGroups[key]) {
      similarGroups[key] = [];
    }
    similarGroups[key].push(idx);
  });

  const similarDuplicates = Object.entries(similarGroups)
    .filter(([, ids]) => ids.length > 1)
    .map(([group, ids]) => ({ group, count: ids.length }))
    .sort((a, b) => b.count - a.count);

  console.log(
    `   Similar Names (first 30 chars): ${similarDuplicates.length} groups`
  );
  if (similarDuplicates.length > 0) {
    similarDuplicates.slice(0, 5).forEach(({ group, count }) => {
      console.log(`      "${group}...": ${count} products`);
    });
    if (similarDuplicates.length > 5) {
      console.log(
        `      ... and ${similarDuplicates.length - 5} more groups`
      );
    }
  }

  // 5. PRICE ANALYSIS
  console.log(`\n💰 5. PRICE ANALYSIS:`);

  const zeroBasePriceCount = allProducts.filter(
    (p) => !p.basePrice || p.basePrice === 0
  ).length;
  const zeroCostCount = allProducts.filter((p) => !p.cost || p.cost === 0)
    .length;

  console.log(
    `   Products with basePrice = 0 or null: ${zeroBasePriceCount}`
  );
  console.log(`   Products with cost = 0 or null: ${zeroCostCount}`);

  // Negative margin (cost > basePrice)
  const negativeMargin = allProducts
    .filter((p) => p.cost && p.basePrice && p.cost > p.basePrice)
    .map((p) => ({
      name: p.name,
      cost: p.cost,
      basePrice: p.basePrice,
    }))
    .sort((a, b) => b.cost - a.cost);

  console.log(
    `   Products with cost > basePrice: ${negativeMargin.length}`
  );
  if (negativeMargin.length > 0) {
    console.log(`      (showing first 5)`);
    negativeMargin.slice(0, 5).forEach(({ name, cost, basePrice }) => {
      const margin = ((basePrice - cost) / cost * 100).toFixed(1);
      console.log(
        `      ${name}: cost=$${cost.toFixed(2)}, price=$${basePrice.toFixed(2)} (${margin}% margin)`
      );
    });
  }

  // Average price by category
  console.log(`\n   Average basePrice by Category (top 10):`);
  const categoryPrices = {};
  allProducts.forEach((product) => {
    const cat = product.category || "NULL";
    if (!categoryPrices[cat]) {
      categoryPrices[cat] = { sum: 0, count: 0 };
    }
    if (product.basePrice && product.basePrice > 0) {
      categoryPrices[cat].sum += product.basePrice;
      categoryPrices[cat].count += 1;
    }
  });

  Object.entries(categoryPrices)
    .sort(([, a], [, b]) => b.sum / b.count - a.sum / a.count)
    .slice(0, 10)
    .forEach(([category, { sum, count }]) => {
      const avg = count > 0 ? (sum / count).toFixed(2) : "N/A";
      console.log(`      ${category}: $${avg} (${count} products with price)`);
    });

  // 6. NAME QUALITY
  console.log(`\n✏️  6. NAME QUALITY ANALYSIS:`);

  const nameLengths = allProducts.map((p) => ({
    name: p.name,
    length: p.name.length,
  }));
  const avgLength = (
    nameLengths.reduce((sum, p) => sum + p.length, 0) / nameLengths.length
  ).toFixed(2);

  console.log(`   Average name length: ${avgLength} characters`);

  const shortNames = nameLengths
    .filter((p) => p.length < 10)
    .sort((a, b) => a.length - b.length);
  console.log(`   Names shorter than 10 chars: ${shortNames.length}`);
  if (shortNames.length > 0) {
    console.log(`      (showing first 5)`);
    shortNames.slice(0, 5).forEach(({ name, length }) => {
      console.log(`      "${name}" (${length} chars)`);
    });
  }

  const longNames = nameLengths
    .filter((p) => p.length > 100)
    .sort((a, b) => b.length - a.length);
  console.log(`   Names longer than 100 chars: ${longNames.length}`);
  if (longNames.length > 0) {
    console.log(`      (showing first 5)`);
    longNames.slice(0, 5).forEach(({ name, length }) => {
      const truncated =
        name.length > 80 ? name.substring(0, 77) + "..." : name;
      console.log(`      "${truncated}" (${length} chars)`);
    });
  }

  console.log(`\n   5 Shortest Names:`);
  nameLengths
    .sort((a, b) => a.length - b.length)
    .slice(0, 5)
    .forEach(({ name, length }, i) => {
      console.log(`      ${i + 1}. "${name}" (${length} chars)`);
    });

  console.log(`\n   5 Longest Names:`);
  nameLengths
    .sort((a, b) => b.length - a.length)
    .slice(0, 5)
    .forEach(({ name, length }, i) => {
      const truncated =
        name.length > 80 ? name.substring(0, 77) + "..." : name;
      console.log(`      ${i + 1}. "${truncated}" (${length} chars)`);
    });

  // 7. CATEGORY ANALYSIS
  console.log(`\n📊 7. CATEGORY ANALYSIS:`);

  const distinctCategories = Array.from(new Set(allProducts.map((p) => p.category)))
    .filter((c) => c !== null && c !== "")
    .sort();

  console.log(`   Distinct Categories: ${distinctCategories.length}`);
  distinctCategories.slice(0, 15).forEach((cat) => {
    console.log(`      • ${cat}`);
  });

  if (distinctCategories.length > 15) {
    console.log(`      ... and ${distinctCategories.length - 15} more`);
  }

  const nullCategoryCount = allProducts.filter((p) => !p.category || p.category === "").length;
  console.log(`\n   Products with null/empty category: ${nullCategoryCount}`);

  // Summary
  console.log(
    `\n╔════════════════════════════════════════════════════════════╗`
  );
  console.log(`║                      AUDIT SUMMARY                        ║`);
  console.log(
    `╠════════════════════════════════════════════════════════════╣`
  );
  console.log(`║ Total Products: ${String(totalProducts).padEnd(49)}║`);
  console.log(
    `║ Exact Duplicate Groups: ${String(exactDuplicates.length).padEnd(37)}║`
  );
  console.log(
    `║ Similar Name Groups: ${String(similarDuplicates.length).padEnd(40)}║`
  );
  console.log(
    `║ Data Quality Issues: ${String(zeroBasePriceCount + zeroCostCount + negativeMargin.length).padEnd(40)}║`
  );
  console.log(
    `║ Distinct Categories: ${String(distinctCategories.length).padEnd(39)}║`
  );
  console.log(
    `╚════════════════════════════════════════════════════════════╝`
  );

  console.log("\n✅ Audit complete!");
}

auditProducts();
