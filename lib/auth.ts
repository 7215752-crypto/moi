import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type UserProfile = {
  user_id: string;
  employee_id: string | null;
  full_name: string;
  role: "owner" | "accountant" | "manager" | "employee";
  is_active: boolean;
};

export async function requireUser() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();

  if (error || !data.user) {
    redirect("/login");
  }

  const { data: profile, error: profileError } = await supabase
    .from("user_profiles")
    .select("user_id, employee_id, full_name, role, is_active")
    .eq("user_id", data.user.id)
    .single();

  const typedProfile = profile as UserProfile | null;

  if (profileError || !typedProfile?.is_active) {
    redirect("/auth/signout?reason=no_access");
  }

  return { supabase, user: data.user, profile: typedProfile };
}
