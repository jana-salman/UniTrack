import { connection } from "next/server";
import { PublicPage } from "@/components/public-page";
import { getAllowedEmailDomains } from "@/lib/auth/email";
import { LoginForm } from "./login-form";

export const instant = false;

export default async function LoginPage() {
  await connection();

  return (
    <PublicPage>
      <h1>Sign in to UniTrack</h1>
      <p className="page-description">Use your active university account to access equipment services.</p>
      <LoginForm domains={getAllowedEmailDomains()} />
    </PublicPage>
  );
}
