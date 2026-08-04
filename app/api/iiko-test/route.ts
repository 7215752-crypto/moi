import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getIikoAccessToken, iikoRequest } from "@/lib/iiko/client";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json(
      { ok: false, error: "Необходимо войти в портал." },
      { status: 401 },
    );
  }

  const { data: profile, error: profileError } = await supabase
    .from("user_profiles")
    .select("role, is_active")
    .eq("user_id", user.id)
    .single();

  if (
    profileError ||
    !profile?.is_active ||
    !["owner", "accountant"].includes(profile.role)
  ) {
    return NextResponse.json(
      { ok: false, error: "Недостаточно прав." },
      { status: 403 },
    );
  }

  try {
    const token = await getIikoAccessToken();

    const organizations = await iikoRequest("/api/1/organizations", {
      returnAdditionalInfo: true,
      includeDisabled: false,
    });

    return NextResponse.json({
      ok: true,
      tokenReceived: Boolean(token),
      organizations,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error ? error.message : "Неизвестная ошибка.",
      },
      { status: 500 },
    );
  }
}
