'use client';

import Link from 'next/link';
import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { passwordSchema } from '@edunex/shared';
import { z } from 'zod';
import { ApiError, post } from '@/lib/api';
import { useHydrated } from '@/lib/use-hydrated';
import { Alert, Button, Card, Field, Input } from '@/components/ui/primitives';

const schema = z.object({ name: z.string().trim().max(120).optional(), password: passwordSchema });
type Values = z.infer<typeof schema>;

function Form() {
  const hydrated = useHydrated();
  const token = useSearchParams().get('token') ?? '';
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState } = useForm<Values>({ resolver: zodResolver(schema) });
  const onSubmit = handleSubmit(async (v) => {
    setError(null);
    try {
      await post('/auth/accept-invite', { token, password: v.password, ...(v.name ? { name: v.name } : {}) });
      setDone(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong');
    }
  });
  if (!token) return <Alert>This invitation link is incomplete.</Alert>;
  return done ? (
    <div data-testid="accept-done">
      <Alert tone="success">
        You're all set. <Link href="/login" className="underline">Sign in</Link>
      </Alert>
    </div>
  ) : (
    <form onSubmit={onSubmit} method="post" className="mt-4 space-y-4" noValidate>
      {error ? <Alert>{error}</Alert> : null}
      <Field label="Your name (optional — students keep the name on the school record)" htmlFor="name" error={formState.errors.name?.message}>
        <Input id="name" autoComplete="name" {...register('name')} />
      </Field>
      <Field label="Create a password" htmlFor="password" error={formState.errors.password?.message}>
        <Input id="password" type="password" autoComplete="new-password" data-testid="password" {...register('password')} />
      </Field>
      <Button type="submit" className="w-full" disabled={!hydrated || formState.isSubmitting} data-testid="accept-submit">
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
