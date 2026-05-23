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

  return [value];
}

function asNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
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

function buildOrderLines(variables = {}) {
  return normalizeMealSelection(variables).map((item) => {
    const catalogItem = MEAL_CATALOG[item.mealId];
    const unitPrice = catalogItem?.price || 0;
    const lineTotal = roundMoney(unitPrice * item.portions);

    return {
      slot: item.slot,
      mealId: item.mealId || null,
      mealName: catalogItem?.label || item.mealId || "Unknown meal",
      portions: item.portions,
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
    .map((allergen) => String(allergen).trim().toLowerCase())
    .filter(Boolean);
}

function collectMealAllergens(variables = {}) {
  const fromDmn = [
    ...normalizeDmnAllergens(variables.breakfastAllergens),
    ...normalizeDmnAllergens(variables.lunchAllergens),
    ...normalizeDmnAllergens(variables.dinnerAllergens)
  ];

  if (fromDmn.length > 0) {
    return [...new Set(fromDmn)];
  }

  return [
    ...normalizeMealSelection(variables).flatMap((item) => MEAL_CATALOG[item.mealId]?.allergens || [])
  ];
}

function validateOrder(variables = {}) {
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

  return {
    orderValid: errors.length === 0,
    validationErrors: errors,
    orderId: makeOrderId(variables),
    orderLines,
    totalPortions: orderLines.reduce((sum, line) => sum + line.portions, 0),
    ...totals
  };
}

function checkAvailability(variables = {}) {
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

  const unavailableItems = details.filter((item) => !item.available);

  return {
    itemsAvailable: unavailableItems.length === 0,
    unavailableItems,
    availabilityDetails: details,
    reservationId: unavailableItems.length === 0 ? `RSV-${Date.now()}` : null
  };
}

function decidePayment(variables = {}) {
  const total = asNumber(variables.orderTotal, 0);
  const email = String(variables.customerEmail || "").toLowerCase();
  const totalPortions = asNumber(variables.totalPortions, 0);

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

  createSimpleWorker("check-allergen-conflict", (variables) => {
    const customerAllergens = asArray(variables.customerAllergens).map((item) => String(item).toLowerCase());
    const mealAllergens = collectMealAllergens(variables);
    const conflictingAllergens = [...new Set(mealAllergens.filter((allergen) => customerAllergens.includes(allergen)))];

    return {
      allergenConflict: conflictingAllergens.length > 0,
      customerAllergens,
      mealAllergens,
      conflictingAllergens
    };
  }),

  createSimpleWorker("validate-order", (variables) => validateOrder(variables)),

  createSimpleWorker("check-item-availability", (variables) => checkAvailability(variables)),

  createSimpleWorker("process-payment", async (variables) => {
    const paymentRequestId = variables.paymentRequestId || `PAYREQ-${Date.now()}`;
    const localDecision = decidePayment(variables);
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

  createSimpleWorker("generate-receipt", (variables) => {
    const orderLines = variables.orderLines || buildOrderLines(variables);
    const totals = calculateOrderTotal(orderLines);
    const receiptNumber = `RCPT-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${String(Date.now()).slice(-6)}`;

    return {
      receiptGenerated: true,
      receiptNumber,
      receiptUrl: `https://nutriprep.example/receipts/${receiptNumber}`,
      orderLines,
      ...totals
    };
  }),

  createSimpleWorker("send-order-confirmation", (variables) => ({
    confirmationSent: true,
    confirmationRecipient: variables.recipientEmail,
    confirmationSummary: `Order ${variables.orderId} confirmed. Receipt: ${variables.receiptNumber}`
  })),

  createEmailWorker()
];

console.log("[worker] Local Camunda workers are running.");
console.log(`[scenario] Default active delivery scenario: ${ACTIVE_SCENARIO}`);
console.log(`[scenario] ${SCENARIOS[ACTIVE_SCENARIO].description}`);
console.log("[p1] Meal-ordering workers derive decisions from form variables.");
console.log("[p1] Payment demo controls: email containing 'fail' declines; email containing 'timeout' waits for the timer path; total over 90 EUR declines.");
console.log("[worker] Listening for job types:");
[
  "load-packed-orders",
  "generate_route",
  "update-dispatch-status",
  "mark-order-delivered",
  "mark-delivery-failed",
  "check-allergen-conflict",
  "validate-order",
  "check-item-availability",
  "process-payment",
  "generate-receipt",
  "send-order-confirmation",
  "io.camunda:email:1"
].forEach((jobType, index) => {
  console.log(`  ${index + 1}. ${jobType}`);
});
console.log("[worker] Press Ctrl+C to stop.");
