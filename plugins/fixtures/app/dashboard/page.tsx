import { useState } from "react";
import { cookies } from "next/headers";
import { forwardRef } from "react";

export const runtime = "edge";

export default async function Page() {
	const token = cookies().get("session");
	return <div>{token?.value}</div>;
}
