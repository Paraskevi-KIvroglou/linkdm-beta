/// <reference types="vite/client" />
import { expect, test } from "vitest";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

test("campaigns table is defined in schema", () => {
  expect(schema.tables.campaigns).toBeDefined();
});

test("dmLog table is defined in schema", () => {
  expect(schema.tables.dmLog).toBeDefined();
});

test("extensionTokens table is defined in schema", () => {
  expect(schema.tables.extensionTokens).toBeDefined();
});
