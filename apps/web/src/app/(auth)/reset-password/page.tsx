'use client';

import Link from 'next/link';
import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { passwordSchema } from '@edunex/shared';
import { z } from 'zod';
import { ApiError, post } from '@/lib/api';
import { Alert, Button, Card, Field, Input } from '@/components/ui/primitives';

const schema = z.object({ password: passwordSchema, confirm: z.string() }).refine((v) => v.password === v.confirm, { path: ['confirm'], message: 'Passwords do not match' });
type Values = z.infer<typeof schema>;

function Form() {
  const token = useSearchParams().get('token') ?? '';
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState } = useForm<Values>({ resolver: zodResolver(schema) });
  const onSubmit = handleSubmit(async (v) => {
    setError(null);
    try {
      await post('/auth/reset-password', { token, password: v.password });
      setDone(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong');
    }
  });
  if (!token) return <Alert>This reset link is incomplete. Request a new one.</Alert>;
  return done ? (
    <Alert tone="success">
      Password updated. All other sessions were signed out. <Link href="/login" className="underline">Sign in</Link>
    </Alert>
  ) : (
    <form onSubmit={onSubmit} className="mt-4 space-y-4" noValidate>
      {error ? <Alert>{error}</Alert> : null}
      <Field label="New password" htmlFor="password" error={formState.errors.password?.message}>
        <Input id="password" type="password" autoComplete="new-password" {...register('password')} />
      </Field>
      <Field label="Confirm password" htmlFor="confirm" error={formState.errors.confirm?.message}>
        <Input id="confirm" type="password" autoComplete="new-password" {...register('confirm')} />
      </Field>
      <Button type="submit" className="w-full" disabled={formState.isSubmitting}>
        Set new password
      </Button>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <Card className="p-6">
      <h2 className="text-lg font-semibold">Choose a new password</h2>
      <Suspense>
        <Form />
      </Suspense>
    </Card>
  );
}
