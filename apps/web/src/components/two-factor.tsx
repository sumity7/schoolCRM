'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { errorText, post } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Alert, Badge, Button, Card, Field, Input } from '@/components/ui/primitives';

/** Two-factor (TOTP) setup / removal — used on the school Security page and in the platform console. */
export function TwoFactor() {
  const { me, refresh } = useAuth();
  const [setup, setSetup] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [code, setCode] = useState('');
  const [pw, setPw] = useState('');
  const start = useMutation({ mutationFn: async () => (await post<{ secret: string; otpauthUrl: string }>('/auth/mfa/setup', {})).data, onSuccess: setSetup });
  const enable = useMutation({ mutationFn: async () => post('/auth/mfa/enable', { code }), onSuccess: async () => { setSetup(null); setCode(''); await refresh(); } });
  const disable = useMutation({ mutationFn: async () => post('/auth/mfa/disable', { password: pw, code }), onSuccess: async () => { setPw(''); setCode(''); await refresh(); } });
  const on = me?.mfa?.enabled;
  return (
    <Card className="space-y-3 p-4" data-testid="mfa-card">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-medium">Two-factor authentication</h2>
        <Badge tone={on ? 'success' : 'muted'}>{on ? 'on' : 'off'}</Badge>
      </div>
      <p className="text-sm text-muted-foreground">After your password you also enter a 6-digit code from an authenticator app (Google Authenticator, Microsoft Authenticator, Aegis…). {me?.platformRole ? 'Required for platform staff.' : 'Recommended for owners, principals and accountants.'}</p>
      {!on && !setup ? <Button onClick={() => start.mutate()} disabled={start.isPending} data-testid="mfa-start">Set up</Button> : null}
      {start.error ? <Alert>{errorText(start.error)}</Alert> : null}
      {setup ? (
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); enable.mutate(); }}>
          <ol className="list-decimal space-y-1 pl-5 text-sm">
            <li>In your authenticator app choose “Enter a setup key” (or open the link below on your phone).</li>
            <li>Key: <code className="select-all break-all rounded bg-muted px-1 font-mono" data-testid="mfa-secret">{setup.secret}</code> (time-based)</li>
            <li>Type the 6-digit code it shows.</li>
          </ol>
          <a href={setup.otpauthUrl} className="block break-all text-xs text-primary underline">{setup.otpauthUrl}</a>
          <Field label="Code from the app" htmlFor="mfa-c"><Input id="mfa-c" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} data-testid="mfa-enable-code" /></Field>
          {enable.error ? <Alert>{errorText(enable.error)}</Alert> : null}
          <Button type="submit" disabled={enable.isPending || code.length !== 6} data-testid="mfa-enable">Turn on</Button>
        </form>
      ) : null}
      {on && !me?.platformRole ? (
        <form className="grid gap-2 sm:grid-cols-[1fr_140px_auto]" onSubmit={(e) => { e.preventDefault(); disable.mutate(); }}>
          <Input type="password" aria-label="Password" placeholder="Password" value={pw} onChange={(e) => setPw(e.target.value)} />
          <Input aria-label="Code" placeholder="Code" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
          <Button type="submit" variant="outline" disabled={disable.isPending || !pw || code.length !== 6}>Turn off</Button>
          {disable.error ? <div className="sm:col-span-3"><Alert>{errorText(disable.error)}</Alert></div> : null}
        </form>
      ) : null}
    </Card>
  );
}

