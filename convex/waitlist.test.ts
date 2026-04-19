/// <reference types="vite/client" />
import { expect, test } from "vitest";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

test("waitlist table is defined in schema", () => {
  expect(schema.tables.waitlist).toBeDefined();
});
