import { generateText, tool, convertToCoreMessages } from "ai";

export async function run() {
	const result = await generateText({ model, system: "hi", maxTokens: 100, maxSteps: 3 });
	const t = tool({ parameters: schema });
	return result.fullStream;
}

export function verify(body: string, sig: string) {
	return stripe.webhooks.constructEventWithoutVerification(body);
}
