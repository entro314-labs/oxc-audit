import { exec } from "node:child_process";

export const stripeKey = "sk_live_51ABCDEFGHIJKLMNOPQRSTUVWX";

export function resetToken() {
	const token = Math.random().toString(36).slice(2);
	exec(`git checkout ${token}`, () => {});
	return token;
}

export function render(el: HTMLElement, body: string) {
	el.innerHTML = body;
}
