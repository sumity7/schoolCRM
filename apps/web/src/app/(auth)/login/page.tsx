'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import type { MeResponse } from '@edunex/shared';
import { loginSchema, type LoginInput } from '@edunex/shared';
import { ApiError, get, post } from '@/lib/api';
import { landingFor } from '@/lib/landing';
import { useHydrated } from '@/lib/use-hydrated';
import { Eye, EyeOff } from 'lucide-react';
import { Alert, Button, Card, Field, Input } from '@/components/ui/primitives';
import { DemoAccounts, type DemoAccount } from '@/components/demo-accounts';

export default function LoginPage() {
  const qc = useQueryClient();
  const hydrated = useHydrated();
  const [error, setError] = useState<string | null>(null);
  const [needCode, setNeedCode] = useState(false);
  const [code, setCode] = useState('');
  const [verifying, setVerifying] = useState(false);

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setVerifying(true);
    try {
      await post('/auth/mfa/verify', { code: code.trim() });
      const me = (await get<MeResponse>('/auth/me')).data;
      qc.setQueryData(['me'], me);
      window.location.assign(landingFor(me));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not verify the code');
      setVerifying(false);
    }
  }
  const { register, handleSubmit, formState, setValue, watch } = useForm<LoginInput>({ resolver: zodResolver(loginSchema), defaultValues: { rememberMe: false } });
  const [showPassword, setShowPassword] = useState(false);
  const [demo, setDemo] = useState<DemoAccount | null>(null);
  const identifier = watch('identifier');
  // editing the identifier by hand ends the "demo selected" state (the card never decides who you are — the server does)
  useEffect(() => {
    if (demo && identifier !== demo.identifier) setDemo(null);
  }, [demo, identifier]);

  function pick(a: DemoAccount) {
    if (!a.available || !a.identifier || !a.password) return;
    setError(null);
    setValue('identifier', a.identifier, { shouldValidate: true });
    setValue('password', a.password, { shouldValidate: true });
    setDemo(a);
  }
  function clearDemo() {
    setValue('identifier', '');
    setValue('password', '');
    setShowPassword(false);
    setDemo(null);
    setError(null);
  }

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    try {
      const res = await post<MeResponse>('/auth/login', values);
      if (res.data.mfa?.pending) {
        setNeedCode(true);
        return;
      }
      qc.setQueryData(['me'], res.data);
      window.location.assign(landingFor(res.data));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not sign in');
    }
  });

  if (needCode) {
    return (
      <Card className="p-6">
        <h2 className="mb-1 text-lg font-semibold">Two-factor code</h2>
        <p className="mb-5 text-sm text-muted-foreground">Enter the 6-digit code from your authenticator app.</p>
        <form onSubmit={verify} className="space-y-4">
          {error ? <Alert>{error}</Alert> : null}
          <Field label="Code" htmlFor="code"><Input id="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} data-testid="mfa-code" autoFocus /></Field>
          <Button type="submit" className="w-full" disabled={verifying || code.length !== 6} data-testid="mfa-submit">{verifying ? 'Checking…' : 'Verify'}</Button>
        </form>
      </Card>
    );
  }

  return (
    <>
    <Card className="p-6">
      <h2 className="mb-1 text-lg font-semibold">Sign in</h2>
      <p className="mb-5 text-sm text-muted-foreground">Use your email or mobile number.</p>
      <form onSubmit={onSubmit} method="post" className="space-y-4" noValidate>
        {error ? <Alert>{error}</Alert> : null}
        <Field label="Email or mobile number" htmlFor="identifier" error={formState.errors.identifier?.message}>
          <Input id="identifier" autoComplete="username" inputMode="email" data-testid="identifier" {...register('identifier')} />
        </Field>
        <Field label="Password" htmlFor="password" error={formState.errors.password?.message}>
          <div className="relative">
            <Input id="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" className="pr-12" data-testid="password" {...register('password')} />
            <button type="button" onClick={() => setShowPassword((v) => !v)} aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword} data-testid="toggle-password" className="absolute inset-y-0 right-0 flex min-w-11 items-center justify-center rounded-r-lg text-muted-foreground hover:text-foreground">
              {showPassword ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
            </button>
          </div>
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="h-4 w-4" {...register('rememberMe')} /> Keep me signed in
        </label>
        <Button type="submit" className="w-full" disabled={!hydrated || formState.isSubmitting} data-testid="login-submit">
          {formState.isSubmitting ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
      <p className="mt-4 text-center text-sm">
        <Link href="/forgot-password" className="text-primary underline-offset-2 hover:underline">
          Forgot your password?
        </Link>
      </p>
    </Card>
    <DemoAccounts selectedKey={demo?.key ?? null} onPick={pick} onClear={clearDemo} />
    </>
  );
}
