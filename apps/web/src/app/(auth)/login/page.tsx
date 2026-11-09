'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import type { MeResponse } from '@edunex/shared';
import { loginSchema, type LoginInput } from '@edunex/shared';
import { ApiError, post } from '@/lib/api';
import { Alert, Button, Card, Field, Input } from '@/components/ui/primitives';

export default function LoginPage() {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState } = useForm<LoginInput>({ resolver: zodResolver(loginSchema), defaultValues: { rememberMe: false } });

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    try {
      const res = await post<MeResponse>('/auth/login', values);
      qc.setQueryData(['me'], res.data);
      window.location.assign(res.data.activeMembershipId ? '/app' : '/select-school');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not sign in');
    }
  });

  return (
    <Card className="p-6">
      <h2 className="mb-1 text-lg font-semibold">Sign in</h2>
      <p className="mb-5 text-sm text-muted-foreground">Use your email or mobile number.</p>
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {error ? <Alert>{error}</Alert> : null}
        <Field label="Email or mobile number" htmlFor="identifier" error={formState.errors.identifier?.message}>
          <Input id="identifier" autoComplete="username" inputMode="email" data-testid="identifier" {...register('identifier')} />
        </Field>
        <Field label="Password" htmlFor="password" error={formState.errors.password?.message}>
          <Input id="password" type="password" autoComplete="current-password" data-testid="password" {...register('password')} />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="h-4 w-4" {...register('rememberMe')} /> Keep me signed in
        </label>
        <Button type="submit" className="w-full" disabled={formState.isSubmitting} data-testid="login-submit">
          {formState.isSubmitting ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
      <p className="mt-4 text-center text-sm">
        <Link href="/forgot-password" className="text-primary underline-offset-2 hover:underline">
          Forgot your password?
        </Link>
      </p>
    </Card>
  );
}
