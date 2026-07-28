import { LoginForm } from "@/components/login-form";

type Props = {
  searchParams: Promise<{ error?: string; next?: string }>;
};

const errors: Record<string, string> = {
  required: "Р—Р°РїРѕР»РЅРёС‚Рµ email Рё РїР°СЂРѕР»СЊ.",
  invalid: "РќРµРІРµСЂРЅС‹Р№ email РёР»Рё РїР°СЂРѕР»СЊ.",
  no_access: "РЈС‡С‘С‚РЅР°СЏ Р·Р°РїРёСЃСЊ РЅРµ РёРјРµРµС‚ РґРѕСЃС‚СѓРїР° Рє РїРѕСЂС‚Р°Р»Сѓ.",
};

export default async function LoginPage({ searchParams }: Props) {
  const query = await searchParams;
  const nextPath = query.next?.startsWith("/") ? query.next : "/dashboard";

  return (
    <main className="login-shell">
      <section className="login-brand-panel">
        <div className="brand-mark">R</div>
        <p className="eyebrow light">REDMAN</p>
        <h1>Р—Р°СЂРїР»Р°С‚Р° Р±РµР· С‡С‘СЂРЅРѕРіРѕ СЏС‰РёРєР°</h1>
        <p>
          Р§Р°СЃС‹, РјРѕС‚РёРІР°С†РёСЏ iiko, СЂСѓС‡РЅС‹Рµ РЅР°С‡РёСЃР»РµРЅРёСЏ Рё РєРѕСЂСЂРµРєС‚РёСЂРѕРІРєРё вЂ” РІ РѕРґРЅРѕР№
          РїРѕРЅСЏС‚РЅРѕР№ СЂР°СЃС€РёС„СЂРѕРІРєРµ.
        </p>
        <div className="login-feature-grid">
          <div>
            <strong>2</strong>
            <span>СЂР°СЃС‡С‘С‚РЅС‹С… РїРµСЂРёРѕРґР° РІ РјРµСЃСЏС†</span>
          </div>
          <div>
            <strong>100%</strong>
            <span>РёСЃС‚РѕСЂРёРё РёР·РјРµРЅРµРЅРёР№</span>
          </div>
        </div>
      </section>

      <section className="login-card-wrap">
        <div className="login-card">
          <p className="eyebrow">Р›РёС‡РЅС‹Р№ РєР°Р±РёРЅРµС‚</p>
          <h2>Р’С…РѕРґ РІ MOI Group</h2>
          <p className="muted">РСЃРїРѕР»СЊР·СѓР№С‚Рµ СѓС‡С‘С‚РЅСѓСЋ Р·Р°РїРёСЃСЊ, СЃРѕР·РґР°РЅРЅСѓСЋ РІ Supabase.</p>
          {query.error ? (
            <div className="alert" role="alert">
              {errors[query.error] ?? "РќРµ СѓРґР°Р»РѕСЃСЊ РІРѕР№С‚Рё."}
            </div>
          ) : null}
          <LoginForm nextPath={nextPath} />
          <p className="privacy-note">
            Р”РѕСЃС‚СѓРї Рє РґР°РЅРЅС‹Рј РѕРіСЂР°РЅРёС‡РёРІР°РµС‚СЃСЏ СЂРѕР»СЊСЋ РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ Рё РїРѕР»РёС‚РёРєР°РјРё RLS.
          </p>
        </div>
      </section>
    </main>
  );
}

