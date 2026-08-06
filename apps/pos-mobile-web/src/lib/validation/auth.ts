import { z } from "zod";

export const storeCodeSchema = z.object({ storeCode: z.string().trim().min(2).max(64) });
export const branchSelectSchema = z.object({ branchId: z.string().uuid() });
export const employeeVerifySchema = z.object({ employeeCode: z.string().trim().regex(/^\d{1,32}$/, "employee_code_digits_only") });
export const deviceSelectSchema = z.object({ deviceId: z.string().uuid() });
export const voidPinSchema = z.string().trim().regex(/^\d{6}$/, "void_pin_six_digits");
