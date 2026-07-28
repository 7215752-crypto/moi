import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

type GoogleRate = {
  employee_name: string;
  source_group_code: string;
  source_group_name: string;
  hourly_rate: number | null;
  shift_or_monthly_rate: number | null;
  valid_from: string;
  source_sheet: string;
  source_row: number;
};

type GoogleRatesResponse = {
  ok: boolean;
  error?: string;
  year?: number;
  month?: number;
  half?: number;
  period_start?: string;
  period_end?: string;
  source_sheet?: string;
  count?: number;
  rates?: GoogleRate[];
};

async function getAuthorizedClient() {
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return {
      supabase,
      errorResponse: NextResponse.json(
        {
          ok: false,
          error: "Необходимо войти в портал.",
        },
        { status: 401 },
      ),
    };
  }

  const { data: profile, error: profileError } =
    await supabase
      .from("user_profiles")
      .select("role, is_active")
      .eq("user_id", user.id)
      .single();

  if (profileError || !profile?.is_active) {
    return {
      supabase,
      errorResponse: NextResponse.json(
        {
          ok: false,
          error: "Профиль пользователя неактивен.",
        },
        { status: 403 },
      ),
    };
  }

  if (
    !["owner", "accountant"].includes(profile.role)
  ) {
    return {
      supabase,
      errorResponse: NextResponse.json(
        {
          ok: false,
          error:
            "Недостаточно прав для работы со ставками.",
        },
        { status: 403 },
      ),
    };
  }

  return {
    supabase,
    errorResponse: null,
  };
}

function getPeriod(request: NextRequest) {
  const now = new Date();

  const year = Number(
    request.nextUrl.searchParams.get("year") ??
      now.getFullYear(),
  );

  const month = Number(
    request.nextUrl.searchParams.get("month") ??
      now.getMonth() + 1,
  );

  const half = Number(
    request.nextUrl.searchParams.get("half") ?? 1,
  );

  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    month < 1 ||
    month > 12 ||
    (half !== 1 && half !== 2)
  ) {
    return {
      year: null,
      month: null,
      half: null,

      errorResponse: NextResponse.json(
        {
          ok: false,
          error:
            "Некорректный год, месяц или половина месяца.",
        },
        { status: 400 },
      ),
    };
  }

  return {
    year,
    month,
    half: half as 1 | 2,
    errorResponse: null,
  };
}

export async function GET(request: NextRequest) {
  try {
    const { errorResponse } =
      await getAuthorizedClient();

    if (errorResponse) {
      return errorResponse;
    }

    const period = getPeriod(request);

    if (period.errorResponse) {
      return period.errorResponse;
    }

    const apiUrl =
      process.env.GOOGLE_SCHEDULE_API_URL;

    const apiToken =
      process.env.GOOGLE_SCHEDULE_API_TOKEN;

    if (!apiUrl || !apiToken) {
      throw new Error(
        "В Vercel не настроены переменные Google API.",
      );
    }

    const googleUrl = new URL(apiUrl);

    googleUrl.searchParams.set(
      "token",
      apiToken,
    );

    googleUrl.searchParams.set(
      "resource",
      "rates",
    );

    googleUrl.searchParams.set(
      "year",
      String(period.year),
    );

    googleUrl.searchParams.set(
      "month",
      String(period.month),
    );

    googleUrl.searchParams.set(
      "half",
      String(period.half),
    );

    const googleResponse = await fetch(
      googleUrl.toString(),
      {
        cache: "no-store",
      },
    );

    if (!googleResponse.ok) {
      throw new Error(
        `Google вернул ошибку HTTP ${googleResponse.status}.`,
      );
    }

    const result =
      (await googleResponse.json()) as GoogleRatesResponse;

    if (
      !result.ok ||
      !Array.isArray(result.rates)
    ) {
      throw new Error(
        result.error ??
          "Google не вернул данные ставок.",
      );
    }

    return NextResponse.json({
      ok: true,
      year: period.year,
      month: period.month,
      half: period.half,
      period_start: result.period_start,
      period_end: result.period_end,
      source_sheet: result.source_sheet,
      count: result.rates.length,
      rates: result.rates,
    });
  } catch (error) {
    console.error(error);

    return NextResponse.json(
      {
        ok: false,

        error:
          error instanceof Error
            ? error.message
            : "Неизвестная ошибка.",
      },
      { status: 500 },
    );
  }
}