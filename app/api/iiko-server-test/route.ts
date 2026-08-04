import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAttendanceXml } from "@/lib/iiko/server-client";

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
    const xml = await getAttendanceXml("2026-07-16", "2026-07-31");

    return NextResponse.json({
      ok: true,
      xmlLength: xml.length,
      xmlPreview: xml.substring(0, 2000),
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
