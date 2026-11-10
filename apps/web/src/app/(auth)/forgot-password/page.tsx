'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { forgotPasswordSchema } from '@edunex/shared';
import type { z } from 'zod';
import { ApiError, post } from '@/lib/api';
import { useHydrated } from '@/lib/use-hydrated';
import { Alert, Button, Card, Field, Input } from '@/components/ui/primitives';

type Values = z.infer<typeof forgotPasswordSchema>;

export default function ForgotPasswordPage() {
  const hydrated = useHydrated();
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState } = useForm<Values>({ resolver: zodResolver(forgotPasswordSchema) });
  const onSubmit = handleSubmit(async (v) => {
    setError(null);
    try {
      await post('/auth/forgot-password', v);
      setDone(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong');
    }
  });
  return (
    <Card className="p-6">
      <h2 className="mb-1 text-lg font-semibold">Reset your password</h2>
      {done ? (
        <Alert tone="success">If an account exists for that email, a reset link has been sent. (Development builds write the email to a local outbox instead of sending it.)</Alert>
      ) : (
        <form onSubmit={onSubmit} method="post" className="mt-4 space-y-4" noValidate>
          {error ? <Alert>{error}</Alert> : null}
          <Field label="Email" htmlFor="identifier" error={formState.errors.identifier?.message}>
            <Input id="identifier" type="email" autoComplete="email" {...register('identifier')} />
          </Field>
          <Button type="submit" className="w-full" disabled={!hydrated || formState.isSubmitting}>
            Send reset link
          </Button>
        </form>
      )}
      <p className="mt-4 text-center text-sm">
        <Link href="/login" className="text-primary hover:underline">
          Back to sign in
        </Link>
      </p>
    </Card>
  );
}
