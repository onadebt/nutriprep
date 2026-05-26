const { Camunda8 } = require("@camunda8/sdk");
const nodemailer = require("nodemailer");

const CAMUNDA_CONFIG = {
  ZEEBE_REST_ADDRESS: "https://cdg-1.zeebe.camunda.io/47804366-6f9a-46b7-ac61-b050497bac92",
  ZEEBE_GRPC_ADDRESS: "grpcs://47804366-6f9a-46b7-ac61-b050497bac92.cdg-1.zeebe.camunda.io:443",
  ZEEBE_CLIENT_ID: "KzoLE6x~BYxNT~Ayyw48E89erHeaVgvr",
  ZEEBE_CLIENT_SECRET: "qQR7fF_~0IxlF~GuyCRIxSN5kLc8dxK_BzWD9lo6BgFhey0pCmfm5r4e-OMLSA7S",
  CAMUNDA_OAUTH_URL: "https://login.cloud.camunda.io/oauth/token",
  CAMUNDA_AUTH_STRATEGY: "OAUTH",
  ZEEBE_TOKEN_AUDIENCE: "zeebe.camunda.io"
};

const REQUIRED_CONFIG = [
  "ZEEBE_REST_ADDRESS",
  "ZEEBE_GRPC_ADDRESS",
  "ZEEBE_CLIENT_ID",
  "ZEEBE_CLIENT_SECRET",
  "CAMUNDA_OAUTH_URL"
];

for (const key of REQUIRED_CONFIG) {
  if (!CAMUNDA_CONFIG[key] || CAMUNDA_CONFIG[key].startsWith("your-")) {
    console.warn(`[config] Replace CAMUNDA_CONFIG.${key} in worker.js`);
  }
}

const ACTIVE_SCENARIO = "delayedWithEmail";
const ACTIVE_P1_SCENARIO = "p1PaymentTimeout";
const CAMEL_PAYMENT_URL = "http://localhost:8081/payment";
const PAYMENT_RESULT_MESSAGE = "payment-result";
const PAYMENT_MESSAGE_TTL_MS = 10 * 60 * 1000;
const CURRENCY = "EUR";
const DELIVERY_FEE = 3.5;

const SCENARIOS = {
  happyPath: {
    description: "Routes are feasible, no delay, delivery succeeds.",
    routesFeasible: true,
    deliveryDelayed: false,
    deliverySuccessful: true,
    redeliveryPossible: true,
    sendEmail: false
  },
  routeProblemThenRetry: {
    description: "Routes are not feasible, token goes to capacity review.",
    routesFeasible: false,
    deliveryDelayed: false,
    deliverySuccessful: true,
    redeliveryPossible: true,
    sendEmail: false
  },
  delayedWithEmail: {
    description: "Routes are feasible, delivery is delayed, email is sent, delivery succeeds.",
    routesFeasible: true,
    deliveryDelayed: true,
    deliverySuccessful: true,
    redeliveryPossible: true,
    sendEmail: true
  },
  failedThenRedelivery: {
    description: "Delivery fails first, customer can receive redelivery.",
    routesFeasible: true,
    deliveryDelayed: false,
    deliverySuccessful: false,
    redeliveryPossible: true,
    sendEmail: false
  },
  failedNoRedelivery: {
    description: "Delivery fails and no redelivery is possible.",
    routesFeasible: true,
    deliveryDelayed: false,
    deliverySuccessful: false,
    redeliveryPossible: false,
    sendEmail: false
  }
};

const P1_SCENARIOS = {
  p1HappyPath: {
    description: "Order passes non-allergen checks, payment responds successfully, confirmation is sent.",
    orderValid: true,
    itemsAvailable: true,
    paymentResponded: true,
    transactionSuccessful: true,
    sendPaymentRequest: true,
    sendFailureReport: false,
    sendCustomerFailureNotice: false,
    sendOrderRejectionNotice: false,
    sendOrderConfirmation: true
  },
  p1InvalidOrder: {
    description: "Order is rejected after validation.",
    orderValid: false,
    itemsAvailable: true,
    paymentResponded: false,
    transactionSuccessful: false,
    sendPaymentRequest: false,
    sendFailureReport: false,
    sendCustomerFailureNotice: false,
    sendOrderRejectionNotice: true,
    sendOrderConfirmation: false
  },
  p1ItemsUnavailable: {
    description: "Order is valid, but selected meals are not available.",
    orderValid: true,
    itemsAvailable: false,
    paymentResponded: false,
    transactionSuccessful: false,
    sendPaymentRequest: false,
    sendFailureReport: false,
    sendCustomerFailureNotice: false,
    sendOrderRejectionNotice: true,
    sendOrderConfirmation: false
  },
  p1PaymentFailed: {
    description: "Payment responds, but transaction is declined.",
    orderValid: true,
    itemsAvailable: true,
    paymentResponded: true,
    transactionSuccessful: false,
    sendPaymentRequest: true,
    sendFailureReport: false,
    sendCustomerFailureNotice: true,
    sendOrderRejectionNotice: false,
    sendOrderConfirmation: false
  },
  p1PaymentTimeout: {
    description: "Payment does not respond, so the timer/manual-resolution path is used.",
    orderValid: true,
    itemsAvailable: true,
    paymentResponded: false,
    transactionSuccessful: false,
    sendPaymentRequest: true,
    sendFailureReport: true,
    sendCustomerFailureNotice: true,
    sendOrderRejectionNotice: false,
    sendOrderConfirmation: false
  }
};

const MEAL_CATALOG = {
  "oatmeal-bowl": {
    label: "Protein Oatmeal Bowl",
    price: 7.9,
    stock: 24,
    allergens: ["gluten", "lactose", "nuts"]
  },
  "egg-omelet": {
    label: "Egg Omelette with Sourdough Bread",
    price: 8.5,
    stock: 18,
    allergens: ["eggs", "lactose", "gluten"]
  },
  "avocado-toast": {
    label: "Avocado Toast with Eggs",
    price: 8.2,
    stock: 16,
    allergens: ["gluten", "eggs", "lactose"]
  },
  "tuna-egg-wrap": {
    label: "Tuna and Egg Breakfast Wrap",
    price: 8.9,
    stock: 8,
    allergens: ["gluten", "fish", "eggs", "lactose"]
  },
  "rice-porridge": {
    label: "Rice Protein Porridge",
    price: 7.5,
    stock: 20,
    allergens: ["lactose", "nuts", "peanuts"]
  },
  "chicken-rice-bowl": {
    label: "Grilled Chicken Rice Bowl",
    price: 11.9,
    stock: 22,
    allergens: []
  },
  "caesar-salad": {
    label: "Chicken Caesar-Inspired Salad Bowl",
    price: 10.9,
    stock: 18,
    allergens: ["gluten", "lactose"]
  },
  "turkey-meatballs": {
    label: "Turkey Meatballs with Whole-Grain Pasta",
    price: 12.5,
    stock: 12,
    allergens: ["gluten", "eggs"]
  },
  "beef-rice": {
    label: "Lean Beef Chili with Rice",
    price: 12.9,
    stock: 12,
    allergens: []
  },
  "salmon-potatoes": {
    label: "Salmon with Sweet Potatoes and Greens",
    price: 13.9,
    stock: 7,
    allergens: ["fish"]
  },
  "lentil-curry": {
    label: "Lentil Curry with Rice",
    price: 10.5,
    stock: 20,
    allergens: []
  },
  "tofu-bowl": {
    label: "Tofu Buddha Bowl",
    price: 10.7,
    stock: 15,
    allergens: ["soybean", "sesame"]
  },
  "chicken-salad": {
    label: "Greek Chicken Salad Plate",
    price: 11.2,
    stock: 18,
    allergens: ["gluten", "lactose"]
  },
  "egg-skillet": {
    label: "Egg and Potato Skillet",
    price: 9.8,
    stock: 14,
    allergens: ["eggs"]
  },
  "beef-bowl": {
    label: "Beef Burrito Bowl",
    price: 12.7,
    stock: 10,
    allergens: ["lactose"]
  },
  "salmon-poke": {
    label: "Salmon Poke-Style Bowl",
    price: 14.5,
    stock: 5,
    allergens: ["fish", "soybean", "sesame", "gluten"]
  }
};

const zeebe = new Camunda8(CAMUNDA_CONFIG).getZeebeGrpcApiClient();

function getScenario(variables = {}) {
  const requestedScenario = variables.scenario || ACTIVE_SCENARIO;
  const scenario = SCENARIOS[requestedScenario];

  if (!scenario) {
    console.warn(`[scenario] Unknown scenario "${requestedScenario}", using "${ACTIVE_SCENARIO}"`);
    return SCENARIOS[ACTIVE_SCENARIO];
  }

  return scenario;
}

function getP1Scenario(variables = {}) {
  const requestedScenario = variables.p1Scenario || ACTIVE_P1_SCENARIO;
  const scenario = P1_SCENARIOS[requestedScenario];

  if (!scenario) {
    console.warn(`[p1-scenario] Unknown scenario "${requestedScenario}", using "${ACTIVE_P1_SCENARIO}"`);
    return P1_SCENARIOS[ACTIVE_P1_SCENARIO];
  }

  return scenario;
}

function createSimpleWorker(jobType, variablesFactory) {
  return zeebe.createWorker({
    taskType: jobType,
    id: `local-${jobType}-worker`,
    maxJobsToActivate: 5,
    pollInterval: 1000,
    timeout: 30000,
    taskHandler: async (job) => {
      const variables =
        typeof variablesFactory === "function"
          ? await variablesFactory(job.variables || {}, getScenario(job.variables || {}), job)
          : {};

      console.log(`[worker] Completing ${jobType}`, variables);
      return job.complete(variables);
    }
  });
}

function normalizeRecipients(value) {
  if (Array.isArray(value)) {
    return value.join(", ");
  }

  return value;
}

function asArray(value) {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value === "object") {
    return Object.entries(value)
      .filter(([, selected]) => selected)
      .map(([key]) => key);
  }

  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [value];
}

function asNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function money(value, currency = CURRENCY) {
  return `${roundMoney(value).toFixed(2)} ${currency}`;
}

function hashString(value) {
  let hash = 2166136261;

  for (const char of String(value)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

function seededRandom(seed) {
  let state = hashString(seed) || 1;

  return () => {
    state = Math.imul(1664525, state) + 1013904223;
    return (state >>> 0) / 4294967296;
  };
}

function normalizeMealSelection(variables = {}) {
  const meals = variables.meals || {};
  const portions = variables.portions || {};

  return [
    {
      slot: "breakfast",
      mealId: meals.breakfast || variables.choiceBreakfast,
      portions: asNumber(portions.breakfast ?? variables.breakfastPortions, 0)
    },
    {
      slot: "lunch",
      mealId: meals.lunch || variables.choiceLunch,
      portions: asNumber(portions.lunch ?? variables.lunchPortions, 0)
    },
    {
      slot: "dinner",
      mealId: meals.dinner || variables.choiceDinner,
      portions: asNumber(portions.dinner ?? variables.dinnerPortions, 0)
    }
  ].filter((item) => item.mealId || item.portions > 0);
}

function buildOrderLines(variables = {}, options = {}) {
  const random = options.random || (() => 0.5);
  const randomizePrices = Boolean(options.randomizePrices);

  return normalizeMealSelection(variables).map((item) => {
    const catalogItem = MEAL_CATALOG[item.mealId];
    const basePrice = catalogItem?.price || 0;
    const variation = randomizePrices ? 0.85 + random() * 0.3 : 1;
    const unitPrice = roundMoney(basePrice * variation);
    const lineTotal = roundMoney(unitPrice * item.portions);

    return {
      slot: item.slot,
      mealId: item.mealId || null,
      mealName: catalogItem?.label || item.mealId || "Unknown meal",
      portions: item.portions,
      basePrice,
      unitPrice,
      lineTotal
    };
  });
}

function calculateOrderTotal(orderLines) {
  const subtotal = roundMoney(orderLines.reduce((sum, line) => sum + line.lineTotal, 0));
  return {
    subtotal,
    deliveryFee: subtotal > 0 ? DELIVERY_FEE : 0,
    orderTotal: roundMoney(subtotal > 0 ? subtotal + DELIVERY_FEE : 0),
    currency: CURRENCY
  };
}

function makeOrderId(variables = {}) {
  if (variables.orderId) {
    return variables.orderId;
  }

  const seed = [
    variables.customerEmail || "unknown",
    variables.deliveryDate || new Date().toISOString(),
    JSON.stringify(variables.meals || {})
  ].join("|");
  let hash = 0;

  for (const char of seed) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }

  return `NP-${String(hash).padStart(10, "0").slice(0, 10)}`;
}

function normalizeAllergenName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-");
}

function deliveryDayFactor(deliveryDate) {
  if (!deliveryDate) {
    return 1;
  }

  const day = new Date(deliveryDate).getDay();

  if (day === 0) {
    return 0.45;
  }

  if (day === 6) {
    return 0.65;
  }

  return 1;
}

function normalizeDmnAllergens(value) {
  return asArray(value)
    .flatMap((entry) => {
      if (typeof entry === "string") {
        return [entry];
      }

      if (entry && typeof entry === "object") {
        return [entry.allergen, entry.Allergen, entry.value].filter(Boolean);
      }

      return [];
    })
    .map((allergen) => normalizeAllergenName(allergen))
    .filter(Boolean);
}

function collectMealAllergensBySlot(variables = {}) {
  const dmnAllergensBySlot = {
    breakfast: normalizeDmnAllergens(variables.breakfastAllergens),
    lunch: normalizeDmnAllergens(variables.lunchAllergens),
    dinner: normalizeDmnAllergens(variables.dinnerAllergens)
  };
  const hasDmnResults = Object.values(dmnAllergensBySlot).some((allergens) => allergens.length > 0);

  if (hasDmnResults) {
    return dmnAllergensBySlot;
  }

  return normalizeMealSelection(variables).reduce(
    (result, item) => ({
      ...result,
      [item.slot]: (MEAL_CATALOG[item.mealId]?.allergens || []).map(normalizeAllergenName)
    }),
    { breakfast: [], lunch: [], dinner: [] }
  );
}

function collectMealAllergens(variables = {}) {
  return [...new Set(Object.values(collectMealAllergensBySlot(variables)).flat())];
}

function evaluateAllergenConflict(variables = {}) {
  const customerAllergens = [...new Set(asArray(variables.customerAllergens).map(normalizeAllergenName).filter(Boolean))];
  const mealAllergensBySlot = collectMealAllergensBySlot(variables);
  const selectedMeals = normalizeMealSelection(variables);
  const mealAllergens = [...new Set(Object.values(mealAllergensBySlot).flat())];
  const customerAllergenSet = new Set(customerAllergens);

  const conflictDetails = selectedMeals
    .map((meal) => {
      const allergens = [...new Set(mealAllergensBySlot[meal.slot] || [])];
      const conflicts = allergens.filter((allergen) => customerAllergenSet.has(allergen));

      return {
        slot: meal.slot,
        mealId: meal.mealId,
        mealName: MEAL_CATALOG[meal.mealId]?.label || meal.mealId || "Unknown meal",
        allergens,
        conflicts
      };
    })
    .filter((meal) => meal.conflicts.length > 0);

  const conflictingAllergens = [...new Set(conflictDetails.flatMap((meal) => meal.conflicts))];

  return {
    allergenConflict: conflictingAllergens.length > 0,
    customerAllergens,
    mealAllergens,
    conflictingAllergens,
    allergenConflictDetails: conflictDetails,
    allergenDecision: conflictingAllergens.length > 0 ? "ORDER_CORRECTION_REQUIRED" : "NO_CONFLICT"
  };
}

function validateOrder(variables = {}, p1Scenario = getP1Scenario(variables)) {
  const errors = [];
  const orderLines = buildOrderLines(variables);
  const totals = calculateOrderTotal(orderLines);
  const email = String(variables.customerEmail || "");
  const deliveryDate = variables.deliveryDate ? new Date(variables.deliveryDate) : null;
  const today = new Date();

  today.setHours(0, 0, 0, 0);

  if (!String(variables.customerName || "").trim()) {
    errors.push("Customer name is missing.");
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.push("Customer email is invalid.");
  }

  if (!String(variables.deliveryAddress || "").trim() || String(variables.deliveryAddress || "").trim().length < 10) {
    errors.push("Delivery address must have at least 10 characters.");
  }

  if (!deliveryDate || Number.isNaN(deliveryDate.getTime())) {
    errors.push("Delivery date is missing or invalid.");
  } else if (deliveryDate < today) {
    errors.push("Delivery date cannot be in the past.");
  }

  if (orderLines.length === 0 || orderLines.every((line) => line.portions <= 0)) {
    errors.push("At least one meal portion must be ordered.");
  }

  for (const line of orderLines) {
    if (!MEAL_CATALOG[line.mealId]) {
      errors.push(`${line.slot} meal "${line.mealId}" is not in the menu catalog.`);
    }

    if (!Number.isInteger(line.portions) || line.portions < 0 || line.portions > 10) {
      errors.push(`${line.slot} portions must be a whole number between 0 and 10.`);
    }
  }

  if (!p1Scenario.orderValid) {
    errors.push(`Scenario ${variables.p1Scenario || ACTIVE_P1_SCENARIO} marks the order as invalid.`);
  }

  return {
    orderValid: errors.length === 0,
    validationErrors: errors,
    orderId: makeOrderId(variables),
    orderLines,
    totalPortions: orderLines.reduce((sum, line) => sum + line.portions, 0),
    ...totals
  };
}

function checkAvailability(variables = {}, p1Scenario = getP1Scenario(variables)) {
  const factor = deliveryDayFactor(variables.deliveryDate);
  const details = buildOrderLines(variables).map((line) => {
    const catalogItem = MEAL_CATALOG[line.mealId];
    const availableStock = Math.floor((catalogItem?.stock || 0) * factor);

    return {
      slot: line.slot,
      mealId: line.mealId,
      mealName: line.mealName,
      requested: line.portions,
      availableStock,
      available: Boolean(catalogItem) && line.portions <= availableStock
    };
  });

  const unavailableItems = p1Scenario.itemsAvailable
    ? details.filter((item) => !item.available)
    : details.length > 0
      ? [
        {
          ...details[0],
          available: false,
          scenarioForced: true,
          reason: `Scenario ${variables.p1Scenario || ACTIVE_P1_SCENARIO} marks items as unavailable.`
        }
      ]
      : [
        {
          available: false,
          scenarioForced: true,
          reason: `Scenario ${variables.p1Scenario || ACTIVE_P1_SCENARIO} marks items as unavailable.`
        }
      ];

  return {
    itemsAvailable: unavailableItems.length === 0,
    unavailableItems,
    availabilityDetails: details,
    reservationId: unavailableItems.length === 0 ? `RSV-${Date.now()}` : null
  };
}

function decidePayment(variables = {}, p1Scenario = getP1Scenario(variables)) {
  const total = asNumber(variables.orderTotal, 0);
  const email = String(variables.customerEmail || "").toLowerCase();
  const totalPortions = asNumber(variables.totalPortions, 0);

  if (!p1Scenario.paymentResponded) {
    return {
      p1Scenario: variables.p1Scenario || ACTIVE_P1_SCENARIO,
      paymentResponded: false,
      transactionSuccessful: false,
      paymentStatus: "NO_RESPONSE",
      paymentDecisionReason: p1Scenario.description
    };
  }

  if (!p1Scenario.transactionSuccessful) {
    return {
      p1Scenario: variables.p1Scenario || ACTIVE_P1_SCENARIO,
      paymentResponded: true,
      transactionSuccessful: false,
      paymentStatus: "DECLINED",
      paymentDecisionReason: p1Scenario.description
    };
  }

  if (email.includes("timeout") || email.includes("noresponse")) {
    return {
      p1Scenario: "p1PaymentTimeout",
      paymentResponded: false,
      transactionSuccessful: false,
      paymentStatus: "NO_RESPONSE",
      paymentDecisionReason: "Demo no-response path selected by customer email."
    };
  }

  if (email.includes("fail") || email.includes("decline")) {
    return {
      p1Scenario: "p1PaymentFailed",
      paymentResponded: true,
      transactionSuccessful: false,
      paymentStatus: "DECLINED",
      paymentDecisionReason: "Demo decline path selected by customer email."
    };
  }

  if (total > 90 || totalPortions > 15) {
    return {
      p1Scenario: "p1PaymentFailed",
      paymentResponded: true,
      transactionSuccessful: false,
      paymentStatus: "DECLINED",
      paymentDecisionReason: "Order exceeds mock bank risk limit."
    };
  }

  return {
    p1Scenario: "p1HappyPath",
    paymentResponded: true,
    transactionSuccessful: true,
    paymentStatus: "APPROVED",
    paymentDecisionReason: "Order is within mock bank limits."
  };
}

async function publishPaymentResult(paymentRequestId, variables) {
  if (!paymentRequestId) {
    console.warn("[payment] No paymentRequestId available, cannot publish payment-result message.");
    return false;
  }

  await zeebe.publishMessage({
    name: PAYMENT_RESULT_MESSAGE,
    correlationKey: paymentRequestId,
    messageId: `payment-${paymentRequestId}`,
    timeToLive: PAYMENT_MESSAGE_TTL_MS,
    variables
  });

  console.log(`[payment] Published "${PAYMENT_RESULT_MESSAGE}" for correlation key ${paymentRequestId}`);
  return true;
}

function buildReceipt(variables = {}) {
  const orderId = variables.orderId || makeOrderId(variables);
  const pricingSeed = [
    orderId,
    variables.customerEmail || "",
    variables.deliveryDate || "",
    JSON.stringify(variables.meals || {}),
    JSON.stringify(variables.portions || {})
  ].join("|");
  const random = seededRandom(pricingSeed);
  const orderLines = buildOrderLines(variables, { randomizePrices: true, random });
  const subtotal = roundMoney(orderLines.reduce((sum, line) => sum + line.lineTotal, 0));
  const totalPortions = orderLines.reduce((sum, line) => sum + line.portions, 0);
  const deliveryFee = subtotal > 0 ? roundMoney(2.9 + Math.min(totalPortions, 8) * 0.35 + random() * 1.5) : 0;
  const packagingFee = subtotal > 0 ? roundMoney(totalPortions * 0.25) : 0;
  const discount = subtotal >= 40 ? roundMoney(subtotal * 0.05) : 0;
  const orderTotal = roundMoney(subtotal + deliveryFee + packagingFee - discount);
  const generatedAt = new Date().toISOString();
  const receiptNumber = `RCPT-${generatedAt.slice(0, 10).replace(/-/g, "")}-${String(hashString(pricingSeed)).slice(0, 6)}`;
  const receiptUrl = `https://nutriprep.example/receipts/${receiptNumber}`;
  const customerName = variables.customerName || "customer";
  const deliveryAddress = variables.deliveryAddress || "not specified";
  const deliveryDate = variables.deliveryDate || "not specified";
  const lineRows = orderLines.map(
    (line) =>
      `- ${line.mealName} (${line.slot}), ${line.portions} x ${money(line.unitPrice)} = ${money(line.lineTotal)}`
  );
  const receiptText = [
    `Nutri Prep receipt ${receiptNumber}`,
    "",
    `Order: ${orderId}`,
    `Customer: ${customerName}`,
    `Delivery address: ${deliveryAddress}`,
    `Delivery date: ${deliveryDate}`,
    "",
    "Meals:",
    ...(lineRows.length > 0 ? lineRows : ["- No meals selected"]),
    "",
    `Subtotal: ${money(subtotal)}`,
    `Delivery fee: ${money(deliveryFee)}`,
    `Packaging fee: ${money(packagingFee)}`,
    `Discount: -${money(discount)}`,
    `Total: ${money(orderTotal)}`,
    "",
    "Thank you for ordering from Nutri Prep."
  ].join("\n");
  const receiptHtml = `
<h2>Nutri Prep receipt ${receiptNumber}</h2>
<p><strong>Order:</strong> ${orderId}<br>
<strong>Customer:</strong> ${customerName}<br>
<strong>Delivery address:</strong> ${deliveryAddress}<br>
<strong>Delivery date:</strong> ${deliveryDate}</p>
<table border="1" cellpadding="6" cellspacing="0">
  <thead><tr><th>Meal</th><th>Slot</th><th>Portions</th><th>Unit price</th><th>Total</th></tr></thead>
  <tbody>
    ${orderLines
      .map(
        (line) =>
          `<tr><td>${line.mealName}</td><td>${line.slot}</td><td>${line.portions}</td><td>${money(line.unitPrice)}</td><td>${money(line.lineTotal)}</td></tr>`
      )
      .join("")}
  </tbody>
</table>
<p>
Subtotal: ${money(subtotal)}<br>
Delivery fee: ${money(deliveryFee)}<br>
Packaging fee: ${money(packagingFee)}<br>
Discount: -${money(discount)}<br>
<strong>Total: ${money(orderTotal)}</strong>
</p>`;

  return {
    receiptGenerated: true,
    receiptGeneratedAt: generatedAt,
    receiptNumber,
    receiptUrl,
    receiptText,
    receiptHtml,
    receiptEmailSubject: `Nutri Prep order ${orderId} receipt ${receiptNumber}`,
    receiptPricingSeed: pricingSeed,
    orderId,
    orderLines,
    totalPortions,
    subtotal,
    deliveryFee,
    packagingFee,
    discount,
    orderTotal,
    currency: CURRENCY
  };
}

function loadProductionPlan(variables = {}) {
  const productionDate = variables.productionDate || new Date().toISOString().slice(0, 10);
  const batchId = variables.batchId || `BATCH-${productionDate.replace(/-/g, "")}-001`;
  const plannedMeals = variables.plannedMeals || [
    { mealName: "Chicken rice bowl", portions: 80 },
    { mealName: "Lentil curry", portions: 60 },
    { mealName: "Protein oatmeal bowl", portions: 40 }
  ];
  const totalPortions = plannedMeals.reduce((sum, meal) => sum + asNumber(meal.portions, 0), 0);

  return {
    productionPlanLoaded: true,
    productionDate,
    batchId,
    mealBatchIds: [batchId],
    productionPlan: {
      productionDate,
      batchId,
      plannedMeals,
      totalPortions,
      kitchenShift: variables.kitchenShift || "morning"
    }
  };
}

function generatePreparationChecklist(variables = {}) {
  const productionPlan = variables.productionPlan || {};
  const batchId = variables.batchId || productionPlan.batchId || `BATCH-${Date.now()}`;
  const plannedMeals = productionPlan.plannedMeals || [];

  return {
    preparationChecklistGenerated: true,
    preparationChecklist: {
      batchId,
      items: [
        "Wash hands and clean workstation",
        "Prepare ingredients for planned meals",
        "Check recipe and portion instructions",
        "Prepare labels and packaging material"
      ],
      plannedMeals,
      createdAt: new Date().toISOString()
    }
  };
}

function updateBatchStatus(variables = {}) {
  const qualityOk = variables.qualityOk === true;

  return {
    batchStatusUpdated: true,
    batchStatus: qualityOk ? "READY_FOR_DISPATCH" : "NEEDS_REWORK",
    batchStatusUpdatedAt: new Date().toISOString()
  };
}

function markMealsReady(variables = {}) {
  return {
    dispatchReady: true,
    readyAt: new Date().toISOString(),
    dispatchBatchId: variables.batchId || null
  };
}

function createEmailWorker() {
  return zeebe.createWorker({
    taskType: "io.camunda:email:1",
    id: "local-email-connector-worker",
    maxJobsToActivate: 2,
    pollInterval: 1000,
    timeout: 60000,
    taskHandler: async (job) => {
      const variables = job.variables || {};
      const scenario = getScenario(variables);
      const authentication = variables.authentication || {};
      const smtpConfig = variables.data?.smtpConfig || {};
      const smtpAction = variables.data?.smtpAction || {};

      const host = smtpConfig.smtpHost;
      const port = Number(smtpConfig.smtpPort || 587);
      const secure = smtpConfig.smtpCryptographicProtocol === "TLS" || port === 465;
      const user = authentication.username;
      const pass = authentication.password;
      const from = smtpAction.from || user;
      const to = normalizeRecipients(smtpAction.to);
      const subject = smtpAction.subject || "Delivery delay notice";
      const text = smtpAction.body || "";
      const contentType = smtpAction.contentType || "PLAIN";

      if (!host || !from || !to) {
        throw new Error(`Email job is missing required SMTP fields: host=${!!host}, from=${!!from}, to=${!!to}`);
      }

      const isP1AllergenEmail = subject.toLowerCase().includes("allergen");
      const shouldSendEmail = isP1AllergenEmail ? Boolean(variables.allergenConflict) : scenario.sendEmail;

      if (!shouldSendEmail) {
        console.log(`[email] Skipping "${subject}" because process variables say not to send it`);
        return job.complete({
          emailSent: false,
          emailSkippedByScenario: true,
          emailSubject: subject
        });
      }

      const transporter = nodemailer.createTransport({
        host,
        port,
        secure,
        auth: user && pass ? { user, pass } : undefined
      });

      console.log(`[email] Sending "${subject}" to ${to} via ${host}:${port}`);

      try {
        const info = await transporter.sendMail({
          from,
          to,
          subject,
          text: contentType === "HTML" ? undefined : text,
          html: contentType === "HTML" ? text : undefined
        });

        console.log(`[email] Sent message ${info.messageId || "(no message id)"}`);

        return job.complete({
          emailSent: true,
          emailMessageId: info.messageId || null,
          emailSubject: subject
        });
      } catch (error) {
        console.error(`[email] SMTP send failed for "${subject}", completing task for demo flow: ${error.message}`);

        return job.complete({
          emailSent: false,
          emailFailedButTaskCompleted: true,
          emailSubject: subject,
          emailError: error.message
        });
      }
    }
  });
}

const workers = [
  createSimpleWorker("load-production-plan", (variables) => loadProductionPlan(variables)),

  createSimpleWorker("generate-prep-checklist", (variables) => generatePreparationChecklist(variables)),

  createSimpleWorker("update-batch-status", (variables) => updateBatchStatus(variables)),

  createSimpleWorker("mark-meals-ready", (variables) => markMealsReady(variables)),

  createSimpleWorker("load-packed-orders", () => ({
    packedOrdersLoaded: true
  })),

  createSimpleWorker("generate_route", (_variables, scenario) => {
    const rain = scenario.routesFeasible ? 0 : 1;

    return {
      routesFeasible: scenario.routesFeasible,
      weather: {
        rain,
        temp: 20
      },
      route: {
        provider: "local-worker",
        reason: scenario.routesFeasible ? "Scenario allows delivery route" : "Scenario blocks delivery route"
      }
    };
  }),

  createSimpleWorker("update-dispatch-status", (_variables, scenario) => ({
    dispatchStatus: scenario.deliveryDelayed ? "DELAYED" : "READY_FOR_DELIVERY",
    deliveryDelayed: scenario.deliveryDelayed,
    deliverySuccessful: scenario.deliverySuccessful,
    redeliveryPossible: scenario.redeliveryPossible
  })),

  createSimpleWorker("mark-order-delivered", () => ({
    deliveryStatus: "DELIVERED"
  })),

  createSimpleWorker("mark-delivery-failed", () => ({
    deliveryStatus: "FAILED"
  })),

  createSimpleWorker("check-allergen-conflict", (variables) => evaluateAllergenConflict(variables)),

  createSimpleWorker("validate-order", (variables) => validateOrder(variables, getP1Scenario(variables))),

  createSimpleWorker("check-item-availability", (variables) => checkAvailability(variables, getP1Scenario(variables))),

  createSimpleWorker("process-payment", async (variables) => {
    const p1Scenario = getP1Scenario(variables);
    const paymentRequestId = variables.paymentRequestId || `PAYREQ-${Date.now()}`;
    const localDecision = decidePayment(variables, p1Scenario);
    const requestBody = {
      orderId: variables.orderId || makeOrderId(variables),
      paymentRequestId,
      amount: asNumber(variables.orderTotal, 0),
      currency: variables.currency || CURRENCY,
      customerEmail: variables.customerEmail,
      totalPortions: variables.totalPortions,
      p1Scenario: variables.p1Scenario || localDecision.p1Scenario
    };

    let paymentResult = {
      ...localDecision,
      paymentProvider: "local-payment-policy",
      paymentReference: null,
      camelIntegrated: false
    };

    try {
      console.log(`[camel] Calling payment route ${CAMEL_PAYMENT_URL}`, requestBody);

      const response = await fetch(CAMEL_PAYMENT_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(5000)
      });

      if (!response.ok) {
        throw new Error(`Camel payment route returned HTTP ${response.status}`);
      }

      const result = await response.json();
      console.log("[camel] Payment route response", result);

      paymentResult = {
        ...paymentResult,
        paymentResponded: Boolean(result.paymentResponded),
        transactionSuccessful: Boolean(result.transactionSuccessful),
        paymentProvider: result.paymentProvider || "camel-demo-bank",
        paymentReference: result.paymentReference || null,
        paymentStatus: result.bankStatus || paymentResult.paymentStatus,
        paymentDecisionReason: result.message || paymentResult.paymentDecisionReason,
        camelIntegrated: true
      };
    } catch (error) {
      console.error(`[camel] Payment route unavailable, using local decision: ${error.message}`);
      paymentResult.paymentError = error.message;
    }

    const completedVariables = {
      paymentRequestId,
      ...paymentResult
    };

    if (paymentResult.paymentResponded) {
      await publishPaymentResult(paymentRequestId, completedVariables);
    } else {
      console.log(`[payment] Bank did not respond for ${paymentRequestId}; timer/manual path should continue.`);
    }

    return completedVariables;
  }),

  createSimpleWorker("generate-receipt", (variables) => buildReceipt(variables)),

  createSimpleWorker("send_payment_request", (variables) => {
    const scenario = getP1Scenario(variables);

    return {
      paymentRequestSent: scenario.sendPaymentRequest,
      paymentRequestChannel: "scenario-worker",
      paymentRequestNote: scenario.description
    };
  }),

  createSimpleWorker("payment_failure_report", (variables) => {
    const scenario = getP1Scenario(variables);

    return {
      paymentFailureReported: scenario.sendFailureReport,
      paymentFailureReportRecipient: "banking-system",
      paymentFailureReportNote: scenario.description
    };
  }),

  createSimpleWorker("order_rejected", (variables) => {
    const scenario = getP1Scenario(variables);

    return {
      orderRejectionNoticeSent: scenario.sendOrderRejectionNotice,
      orderRejectionRecipient: variables.customerEmail || null,
      orderRejectionReason: variables.validationErrors?.join("; ") || variables.unavailableItems?.[0]?.reason || scenario.description
    };
  }),

  createSimpleWorker("payment_failure_customer", (variables) => {
    const scenario = getP1Scenario(variables);

    return {
      paymentFailureNoticeSent: scenario.sendCustomerFailureNotice,
      paymentFailureRecipient: variables.customerEmail || null,
      paymentFailureReason: variables.paymentDecisionReason || scenario.description
    };
  }),

  createSimpleWorker("send-order-confirmation", (variables) => {
    const scenario = getP1Scenario(variables);

    return {
      confirmationSent: scenario.sendOrderConfirmation,
      confirmationRecipient: variables.recipientEmail,
      confirmationSubject: variables.receiptEmailSubject || `Nutri Prep order ${variables.orderId} confirmed`,
      confirmationBody: variables.receiptText || `Order ${variables.orderId} confirmed. Receipt: ${variables.receiptNumber}`,
      confirmationSummary: `Order ${variables.orderId} confirmed. Receipt: ${variables.receiptNumber}`
    };
  }),

  createEmailWorker()
];

console.log("[worker] Local Camunda workers are running.");
console.log(`[scenario] Default active delivery scenario: ${ACTIVE_SCENARIO}`);
console.log(`[scenario] ${SCENARIOS[ACTIVE_SCENARIO].description}`);
console.log(`[p1-scenario] Default active P1 scenario: ${ACTIVE_P1_SCENARIO}`);
console.log(`[p1-scenario] ${P1_SCENARIOS[ACTIVE_P1_SCENARIO].description}`);
console.log("[p1] Evaluate allergen conflict and generate receipt derive meaningful results from the order form.");
console.log("[p1] Other P1 message/payment workers use p1Scenario flags. Email containing 'fail' declines; email containing 'timeout' waits for the timer path; total over 90 EUR declines.");
console.log("[worker] Listening for job types:");
[
  "load-production-plan",
  "generate-prep-checklist",
  "update-batch-status",
  "mark-meals-ready",
  "load-packed-orders",
  "generate_route",
  "update-dispatch-status",
  "mark-order-delivered",
  "mark-delivery-failed",
  "check-allergen-conflict",
  "validate-order",
  "check-item-availability",
  "send_payment_request",
  "process-payment",
  "payment_failure_report",
  "generate-receipt",
  "order_rejected",
  "payment_failure_customer",
  "send-order-confirmation",
  "io.camunda:email:1"
].forEach((jobType, index) => {
  console.log(`  ${index + 1}. ${jobType}`);
});
console.log("[worker] Press Ctrl+C to stop.");
