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

const schema = z.object({ name: z.string().trim().min(1, 'Enter your name').max(120), password: passwordSchema });
type Values = z.infer<typeof schema>;

function Form() {
  const token = useSearchParams().get('token') ?? '';
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState } = useForm<Values>({ resolver: zodResolver(schema) });
  const onSubmit = handleSubmit(async (v) => {
    setError(null);
    try {
      await post('/auth/accept-invite', { token, ...v });
      setDone(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong');
    }
  });
  if (!token) return <Alert>This invitation link is incomplete.</Alert>;
  return done ? (
    <Alert tone="success">
      You're all set. <Link href="/login" className="underline">Sign in</Link>
    </Alert>
  ) : (
    <form onSubmit={onSubmit} className="mt-4 space-y-4" noValidate>
      {error ? <Alert>{error}</Alert> : null}
      <Field label="Your name" htmlFor="name" error={formState.errors.name?.message}>
        <Input id="name" autoComplete="name" {...register('name')} />
      </Field>
      <Field label="Create a password" htmlFor="password" error={formState.errors.password?.message}>
        <Input id="password" type="password" autoComplete="new-password" {...register('password')} />
      </Field>
      <Button type="submit" className="w-full" disabled={formState.isSubmitting}>
        Accept invitation
      </Button>
    </form>
  );
}

export default function AcceptInvitePage() {
  return (
    <Card className="p-6">
      <h2 className="text-lg font-semibold">Accept your invitation</h2>
      <Suspense>
        <Form />
      </Suspense>
    </Card>
  );
}
