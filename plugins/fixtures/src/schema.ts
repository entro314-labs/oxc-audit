import { z } from "zod";
import { useQuery, Hydrate } from "@tanstack/react-query";
import { useShallow } from "zustand/react/shallow";

export const User = z.object({
	email: z.string().email(),
	created: z.string().datetime(),
	meta: z.record(z.string()),
}).passthrough();

export const legacy = z.string({ required_error: "required" });

export const name = z.string().min(1).trim();

const Refined = z.object({ a: z.string() }).refine(ok);
export const Rebuilt = z.object({ ...Refined.shape, b: z.string() });

export const decoded = User.safeParse(JSON.parse(raw));

export function useUsers() {
	return useQuery({ queryKey: ["users"], cacheTime: 5000, onSuccess: cache });
}
