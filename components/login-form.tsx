import { login } from "@/app/login/actions";
import { SubmitButton } from "@/components/submit-button";

export function LoginForm({ nextPath }: { nextPath: string }) {
  return (
    <form action={login} className="login-form">
      <input type="hidden" name="next" value={nextPath} />
      <label>
        <span>Email</span>
        <input
          name="email"
          type="email"
          autoComplete="email"
          placeholder="name@company.ru"
          required
        />
      </label>
      <label>
        <span>Пароль</span>
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          placeholder="••••••••"
          required
        />
      </label>
      <SubmitButton />
    </form>
  );
}
