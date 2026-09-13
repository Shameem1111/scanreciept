var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/index.ts
var MAX_RECEIPT_BYTES = 10 * 1024 * 1024;
var MAX_ITEMS = 250;
var DEFAULT_MODEL = "gemini-2.5-flash-lite";
var PROVIDER_TIMEOUT_MS = 45e3;
var ExtractionError = class extends Error {
  constructor(code, message, status) {
    super(message);
    this.code = code;
    this.status = status;
  }
  code;
  status;
  static {
    __name(this, "ExtractionError");
  }
};
function providerError(status) {
  if (status === 401 || status === 403) {
    return new ExtractionError("PROVIDER_AUTH", "Receipt reading is unavailable because the AI service credentials need attention.", 503);
  }
  if (status === 429) {
    return new ExtractionError("PROVIDER_QUOTA", "The AI service scan limit has been reached. Try later; the service owner may need to check quota or billing.", 429);
  }
  if (status === 400 || status === 404) {
    return new ExtractionError("PROVIDER_CONFIG", "The AI service rejected the extraction request. The service owner needs to check the API key, model, and request configuration.", 503);
  }
  return new ExtractionError("PROVIDER_UNAVAILABLE", "The AI service is temporarily unavailable. Please try again shortly.", 503);
}
__name(providerError, "providerError");
var ALLOWED_MIME_TYPES = /* @__PURE__ */ new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf"
]);
var ALLOWED_CATEGORIES = /* @__PURE__ */ new Set([
  "Food",
  "Medicine",
  "Clothing",
  "Household",
  "Electronics",
  "Transport",
  "Restaurant",
  "Travel",
  "Personal Care",
  "Entertainment",
  "Other"
]);
var sensitivePaymentPatterns = [
  /\b(?:IBAN|BIC|SWIFT|CVV|CVC)\b/i,
  /\b(?:EC[- ]?KARTE|GIROCARD|MAESTRO|MASTERCARD|VISA|AMEX)\b/i,
  /\b(?:AUTH|AUTORISIERUNG|AUTHORIZATION|TERMINAL(?:\s*ID)?|TID|MID)\b/i,
  /\b(?:KARTENNR|CARD\s*NO|CARD\s*NUMBER|ACCOUNT\s*NO|PAN)\b/i,
  /\bDE\d{2}(?:\s?\d{4}){4}\s?\d{2}\b/i,
  /(?:\d[ -]*?){13,19}/,
  /\*{2,}\s*\d{2,6}/
];
var receiptSchema = {
  type: "object",
  additionalProperties: false,
  required: ["merchant", "purchaseDate", "total", "currency", "items"],
  properties: {
    merchant: { type: "string" },
    purchaseDate: { type: "string", description: "YYYY-MM-DD, or empty when uncertain" },
    total: { type: "number" },
    currency: { type: "string" },
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["originalText", "name", "category", "quantity", "price", "confidence"],
        properties: {
          originalText: { type: "string" },
          name: { type: "string" },
          category: { type: "string", enum: [...ALLOWED_CATEGORIES] },
          quantity: { type: "number" },
          price: { type: "number" },
          confidence: { type: "number", minimum: 0, maximum: 1 }
        }
      }
    }
  }
};
function headers() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Accept, Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff"
  };
}
__name(headers, "headers");
function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: headers() });
}
__name(json, "json");
function isSensitivePaymentText(value) {
  return sensitivePaymentPatterns.some((pattern) => pattern.test(value));
}
__name(isSensitivePaymentText, "isSensitivePaymentText");
function cleanText(value, maxLength) {
  if (typeof value !== "string") return null;
  const clean = value.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim();
  if (!clean || isSensitivePaymentText(clean)) return null;
  return clean.slice(0, maxLength);
}
__name(cleanText, "cleanText");
function finiteNonNegative(value, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;
}
__name(finiteNonNegative, "finiteNonNegative");
function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return "";
  const parsed = /* @__PURE__ */ new Date(`${value}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value ? "" : value;
}
__name(validDate, "validDate");
function sanitizeExtraction(input) {
  const record = input && typeof input === "object" ? input : {};
  const rawItems = Array.isArray(record.items) ? record.items.slice(0, MAX_ITEMS) : [];
  const items = rawItems.flatMap((rawItem, index) => {
    if (!rawItem || typeof rawItem !== "object") return [];
    const item = rawItem;
    const originalText = cleanText(item.originalText, 160);
    const name = cleanText(item.name, 160);
    if (!originalText || !name) return [];
    return [{
      id: `item-${index + 1}`,
      originalText,
      name,
      category: typeof item.category === "string" && ALLOWED_CATEGORIES.has(item.category) ? item.category : "Other",
      quantity: finiteNonNegative(item.quantity, 1),
      price: finiteNonNegative(item.price),
      confidence: Math.min(1, finiteNonNegative(item.confidence))
    }];
  });
  return {
    merchant: cleanText(record.merchant, 120) ?? "Unknown merchant",
    purchaseDate: validDate(record.purchaseDate),
    total: finiteNonNegative(record.total),
    currency: "EUR",
    source: "ai",
    items
  };
}
__name(sanitizeExtraction, "sanitizeExtraction");
function inferMimeType(file) {
  if (ALLOWED_MIME_TYPES.has(file.type)) return file.type;
  const extension = file.name.toLowerCase().split(".").pop();
  const byExtension = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    pdf: "application/pdf"
  };
  return extension ? byExtension[extension] ?? "" : "";
}
__name(inferMimeType, "inferMimeType");
function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunks = [];
  const chunkSize = 32768;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + chunkSize)));
  }
  return btoa(chunks.join(""));
}
__name(arrayBufferToBase64, "arrayBufferToBase64");
function extractGeminiJson(payload) {
  if (!payload || typeof payload !== "object") throw new Error("Invalid Gemini response");
  const candidates = payload.candidates;
  const text = candidates?.[0]?.content?.parts?.filter((part) => !part.thought).map((part) => part.text ?? "").join("").trim();
  if (!text) throw new Error("Gemini returned no structured receipt");
  const withoutFence = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  return JSON.parse(withoutFence);
}
__name(extractGeminiJson, "extractGeminiJson");
async function extractReceipt(file, mimeType, env) {
  const model = (env.GEMINI_MODEL || DEFAULT_MODEL).trim();
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const receiptBase64 = arrayBufferToBase64(await file.arrayBuffer());
  const prompt = [
    "Extract purchase-memory information from this receipt.",
    "Read German, English, and mixed German/English receipts automatically, without requiring a language selection.",
    "Return only the requested JSON schema.",
    "Never extract, repeat, infer, classify, or return payment or banking information.",
    "Exclude card numbers (including masked numbers), card type, IBAN, BIC/SWIFT, account numbers,",
    "authorization codes, payment references, terminal IDs, processor identifiers, and online-banking data.",
    "Categorize every purchased line item independently.",
    "Keep originalText as printed and provide a normalized product name separately.",
    "Preserve German umlauts and \xC3\u0178. Keep normalized names in the language of the printed item; do not translate originalText.",
    "Interpret German amounts such as 1.234,56 as JSON number 1234.56, and English amounts such as 1,234.56 as 1234.56.",
    "Interpret German dates such as 13.09.2026 as 2026-09-13. Use language and printed context for English dates; leave ambiguous dates empty.",
    "Recognize Summe/Gesamt/Total and MwSt/USt/VAT. Totals, taxes and payment lines are not purchased items.",
    "Use low confidence when uncertain. Do not fabricate unreadable values.",
    "Return dates as YYYY-MM-DD. Return an empty date when it cannot be read reliably.",
    "ReceiptMind currently supports EUR; return EUR as currency."
  ].join(" ");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
  try {
    const options = {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": env.GEMINI_API_KEY
      },
      signal: controller.signal,
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: prompt }] },
        contents: [{
          role: "user",
          parts: [
            { text: "Extract the allowed purchase information from this receipt." },
            { inlineData: { mimeType, data: receiptBase64 } }
          ]
        }],
        generationConfig: {
          temperature: 0,
          responseMimeType: "application/json",
          responseJsonSchema: receiptSchema
        }
      })
    };
    let response = await fetch(endpoint, options);
    if ([500, 502, 503, 504].includes(response.status)) {
      await response.body?.cancel();
      await new Promise((resolve) => setTimeout(resolve, 500));
      response = await fetch(endpoint, options);
    }
    if (!response.ok) {
      console.warn("receipt_extraction_provider_error", { status: response.status });
      throw providerError(response.status);
    }
    let extracted;
    try {
      extracted = sanitizeExtraction(extractGeminiJson(await response.json()));
    } catch {
      if (controller.signal.aborted) throw new ExtractionError("PROVIDER_TIMEOUT", "Receipt reading took too long. Please try again.", 504);
      throw new ExtractionError("INVALID_AI_RESPONSE", "The AI service could not return a readable receipt result. Please try again.", 502);
    }
    if (!extracted.items.length || !extracted.purchaseDate) {
      throw new ExtractionError("UNREADABLE_RECEIPT", "Could not reliably read the items or purchase date. Use a clearer image of the complete German or English receipt.", 422);
    }
    return extracted;
  } catch (error) {
    if (controller.signal.aborted) throw new ExtractionError("PROVIDER_TIMEOUT", "Receipt reading took too long. Please try again.", 504);
    if (error instanceof ExtractionError) throw error;
    throw new ExtractionError("PROVIDER_UNAVAILABLE", "The AI service could not be reached. Please try again shortly.", 503);
  } finally {
    clearTimeout(timeout);
  }
}
__name(extractReceipt, "extractReceipt");
var index_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: headers() });
    if (request.method === "GET" && url.pathname === "/health") {
      return json({ ok: true, service: "receiptmind-api" });
    }
    if (url.pathname !== "/receipt/extract") return json({ error: "Not found" }, 404);
    if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
    if (!env.GEMINI_API_KEY?.trim()) return json({ code: "PROVIDER_CONFIG", error: "Receipt extraction is not configured" }, 503);
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > MAX_RECEIPT_BYTES + 1024 * 1024) {
      return json({ error: "Receipt file is too large. Maximum size is 10 MB." }, 413);
    }
    try {
      let form;
      try {
        form = await request.formData();
      } catch {
        return json({ code: "INVALID_UPLOAD", error: "Receipt upload was invalid. Select the file again and retry." }, 400);
      }
      const entry = form.get("receipt");
      if (!(entry instanceof File)) return json({ error: 'Multipart field "receipt" is required' }, 400);
      if (entry.size === 0) return json({ error: "Receipt file is empty" }, 400);
      if (entry.size > MAX_RECEIPT_BYTES) {
        return json({ error: "Receipt file is too large. Maximum size is 10 MB." }, 413);
      }
      const mimeType = inferMimeType(entry);
      if (!mimeType) return json({ error: "Use a JPEG, PNG, WebP, or PDF receipt." }, 415);
      return json(await extractReceipt(entry, mimeType, env));
    } catch (error) {
      if (error instanceof ExtractionError) return json({ code: error.code, error: error.message }, error.status);
      return json({ error: "Receipt extraction failed. Please try again." }, 502);
    }
  }
};
export {
  index_default as default
};
//# sourceMappingURL=index.js.map
