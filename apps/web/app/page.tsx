import { redirect } from "next/navigation";

// This route exists only to redirect, so it has no static shell to validate.
export const instant = false;

export default function Home() {
  redirect("/dashboard");
}
