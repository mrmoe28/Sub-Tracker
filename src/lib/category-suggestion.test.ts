import { test } from "node:test";
import assert from "node:assert/strict";

import { suggestCategory } from "./category-suggestion";

function base() {
  return {
    merchantName: null as string | null,
    name: "",
    pfcPrimary: null as string | null,
    pfcDetailed: null as string | null,
    pfcConfidenceLevel: null as string | null,
    recurringStreamId: null as string | null,
  };
}

test("curated merchant match wins with HIGH confidence", () => {
  const r = suggestCategory({ ...base(), merchantName: "Netflix" });
  assert.deepEqual(r, {
    categoryName: "Subscriptions",
    confidence: "HIGH",
    source: "MERCHANT",
  });
});

test("adobe maps to Software", () => {
  const r = suggestCategory({ ...base(), merchantName: "Adobe" });
  assert.equal(r?.categoryName, "Software");
  assert.equal(r?.source, "MERCHANT");
});

test("recurring-stream membership maps to Subscriptions", () => {
  const r = suggestCategory({ ...base(), recurringStreamId: "stream_1" });
  assert.deepEqual(r, {
    categoryName: "Subscriptions",
    confidence: "HIGH",
    source: "RECURRING",
  });
});

test("merchant beats recurring beats pfc", () => {
  const r = suggestCategory({
    ...base(),
    merchantName: "Spotify",
    recurringStreamId: "stream_1",
    pfcPrimary: "FOOD_AND_DRINK",
  });
  assert.equal(r?.source, "MERCHANT");
});

test("pfc FOOD_AND_DRINK maps to Meals", () => {
  const r = suggestCategory({
    ...base(),
    pfcPrimary: "FOOD_AND_DRINK",
    pfcConfidenceLevel: "HIGH",
  });
  assert.deepEqual(r, {
    categoryName: "Meals",
    confidence: "HIGH",
    source: "PFC",
  });
});

test("rent detailed splits from utilities primary", () => {
  const rent = suggestCategory({
    ...base(),
    pfcPrimary: "RENT_AND_UTILITIES",
    pfcDetailed: "RENT_AND_UTILITIES_RENT",
    pfcConfidenceLevel: "VERY_HIGH",
  });
  assert.equal(rent?.categoryName, "Rent");

  const utils = suggestCategory({
    ...base(),
    pfcPrimary: "RENT_AND_UTILITIES",
    pfcDetailed: "RENT_AND_UTILITIES_GAS_AND_ELECTRICITY",
    pfcConfidenceLevel: "HIGH",
  });
  assert.equal(utils?.categoryName, "Utilities");
});

test("tax detailed maps to Taxes", () => {
  const r = suggestCategory({
    ...base(),
    pfcPrimary: "GOVERNMENT_AND_NON_PROFIT",
    pfcDetailed: "GOVERNMENT_AND_NON_PROFIT_TAX_PAYMENT",
    pfcConfidenceLevel: "HIGH",
  });
  assert.equal(r?.categoryName, "Taxes");
});

test("income maps to Payroll and transfers map to Transfer", () => {
  assert.equal(
    suggestCategory({ ...base(), pfcPrimary: "INCOME" })?.categoryName,
    "Payroll",
  );
  assert.equal(
    suggestCategory({ ...base(), pfcPrimary: "TRANSFER_OUT" })?.categoryName,
    "Transfer",
  );
  assert.equal(
    suggestCategory({ ...base(), pfcPrimary: "LOAN_PAYMENTS" })?.categoryName,
    "Transfer",
  );
});

test("confidence downgrades from pfcConfidenceLevel", () => {
  assert.equal(
    suggestCategory({
      ...base(),
      pfcPrimary: "TRANSPORTATION",
      pfcConfidenceLevel: "MEDIUM",
    })?.confidence,
    "MEDIUM",
  );
  assert.equal(
    suggestCategory({
      ...base(),
      pfcPrimary: "TRANSPORTATION",
      pfcConfidenceLevel: "LOW",
    })?.confidence,
    "LOW",
  );
  assert.equal(
    suggestCategory({
      ...base(),
      pfcPrimary: "TRANSPORTATION",
      pfcConfidenceLevel: null,
    })?.confidence,
    "LOW",
  );
});

test("ambiguous primary returns null", () => {
  assert.equal(
    suggestCategory({ ...base(), pfcPrimary: "GENERAL_MERCHANDISE" }),
    null,
  );
  assert.equal(suggestCategory(base()), null);
});
