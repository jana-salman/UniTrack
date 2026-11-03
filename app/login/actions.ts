"use server";

import { redirect } from "next/navigation";

import { getAllowedEmailDomains } from "@/lib/auth/email";
import { authenticateWithPassword } from "@/lib/auth/login-service";
import { findProfileById } from "@/lib/profiles";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type LoginState = {
  error?: string;
};

export async function login(
  _previousState: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const supabase = await createSupabaseServerClient();

  const result = await authenticateWithPassword(
    email,
    password,
    getAllowedEmailDomains(),
    {
      async signIn(normalizedEmail, submittedPassword) {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: normalizedEmail,
          password: submittedPassword,
        });

        return !error && data.user
          ? { id: data.user.id, email: data.user.email }
          : null;
      },
      async signOut() {
        await supabase.auth.signOut({ scope: "local" });
      },
      findProfile: findProfileById,
    },
  );

  if (!result.ok) {
    return { error: result.message };
  }

  redirect("/dashboard");
}
