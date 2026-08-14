import { updateTag } from "next/cache";

export async function handler() {
	await db.write();
	updateTag("posts");
}
