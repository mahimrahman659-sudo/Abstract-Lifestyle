'use client';

import { useRef, useState, type FormEvent } from 'react';
import { useAuth } from './AuthProvider';
import { AddressForm, type AddressFormErrors } from '@/components/checkout/AddressForm';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Notice } from '@/components/ui/Notice';
import { userApi } from '@/lib/api/user';
import { ApiError } from '@/lib/api/client';
import { addressUpdatePayload, optionalAddressFields, validateAddress, type AddressFormValues } from '@/lib/validation/address';
import type { Address } from '@/lib/types';

const empty: AddressFormValues = { fullName: '', phone: '', line1: '', isDefault: false };

export function AccountEditor() {
  const { user, refresh, updateUser, invalidateSession } = useAuth();
  const [name, setName] = useState(user?.name ?? '');
  const [editing, setEditing] = useState<string | null>(null);
  const [values, setValues] = useState<AddressFormValues>(empty);
  const [errors, setErrors] = useState<AddressFormErrors>({});
  const [busy, setBusy] = useState(false);
  const requestActive = useRef(false);
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const [notice, setNotice] = useState<{ error: boolean; text: string } | null>(null);
  const run = async (action: () => Promise<unknown>, text: string) => {
    if (requestActive.current || needsRefresh) return;
    requestActive.current = true;
    setBusy(true); setNotice(null);
    try {
      await action();
      const result = await refresh();
      if (result.status === 'error') {
        setNeedsRefresh(true);
        setNotice({ error: true, text: `${text} The latest account information could not be refreshed. Retry refresh to load it without saving again.` });
      } else if (result.status === 'ok') {
        setNeedsRefresh(false);
        setNotice({ error: false, text });
      }
    }
    catch (error) {
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) invalidateSession();
      else setNotice({ error: true, text: error instanceof ApiError ? error.message : 'Could not save changes. Please retry.' });
    }
    finally { setBusy(false); requestActive.current = false; }
  };
  const retryRefresh = async () => {
    if (requestActive.current) return;
    requestActive.current = true; setBusy(true);
    try {
      const result = await refresh();
      if (result.status === 'ok') {
        setNeedsRefresh(false);
        setNotice({ error: false, text: 'Latest account information refreshed.' });
      }
    } finally { setBusy(false); requestActive.current = false; }
  };
  const writeDisabled = busy || needsRefresh;
  const edit = (address: Address) => { setEditing(address._id); setValues({ ...address }); setErrors({}); };
  const saveAddress = (event: FormEvent) => {
    event.preventDefault(); const issues = validateAddress(values); setErrors(issues);
    if (Object.keys(issues).length) return;
    void run(async () => {
      const payload = addressUpdatePayload(values);
      const { address } = editing
        ? await userApi.patchAddress(editing, payload)
        : await userApi.createAddress(payload);
      updateUser((current) => ({ ...current, addresses: current.addresses.some((saved) => saved._id === address._id)
        ? current.addresses.map((saved) => saved._id === address._id ? address : saved)
        : [...current.addresses, address] }));
      // A confirmed create becomes an edit, so another submit cannot duplicate it.
      // Keep the form intact even when its subsequent readback fails.
      setEditing(address._id);
    }, 'Address saved.');
  };
  return <div className="mt-5 space-y-5" aria-busy={busy}>
    {notice ? <Notice tone={notice.error ? 'error' : 'success'}><span role="status">{notice.text}</span></Notice> : null}
    {needsRefresh ? <Button type="button" variant="secondary" disabled={busy} loading={busy} onClick={() => { void retryRefresh(); }}>Retry refresh</Button> : null}
    <form className="space-y-3" onSubmit={(event) => {
      event.preventDefault();
      if (!name.trim() || name.trim().length > 100) { setNotice({ error: true, text: 'Enter a name between 1 and 100 characters.' }); return; }
      void run(async () => {
        const { user: saved } = await userApi.updateProfile(name.trim());
        updateUser(() => saved);
      }, 'Profile saved.');
    }}>
      <Input id="account-name" label="Your name" value={name} maxLength={100} required disabled={busy} autoComplete="name" onChange={(event) => setName(event.target.value)} />
      <Button type="submit" loading={busy} disabled={writeDisabled}>Save name</Button>
    </form>
    <h3 className="font-semibold">Saved addresses</h3>
    {user?.addresses.length === 0 ? <p className="text-sm text-muted">No saved addresses yet. Add a delivery address below.</p> : null}
    <ul className="space-y-3" aria-label="Manage saved addresses">
      {user?.addresses.map((address) => <li key={address._id} className="rounded-xl border border-line p-3">
        <p>{address.fullName}: {address.line1}{address.isDefault ? ' · Default' : ''}</p>
        <p className="text-sm text-muted">{address.phone}</p>
        <p className="text-sm text-muted">{[address.label, address.line2, address.city, address.state, address.postalCode, address.country].filter(Boolean).join(', ')}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button type="button" variant="secondary" disabled={writeDisabled} onClick={() => edit(address)}>Edit address</Button>
          {!address.isDefault ? <Button type="button" variant="secondary" disabled={writeDisabled} onClick={() => void run(async () => {
            const { address: saved } = await userApi.patchAddress(address._id, { isDefault: true });
            updateUser((current) => ({ ...current, addresses: current.addresses.map((item) => item._id === saved._id ? saved : { ...item, isDefault: false }) }));
          }, 'Default address updated.')}>Set default</Button> : null}
          <Button type="button" variant="ghost" disabled={writeDisabled} onClick={() => {
            if (window.confirm('Delete this saved address? Existing orders keep their delivery address.')) void run(async () => {
              await userApi.deleteAddress(address._id);
              updateUser((current) => ({ ...current, addresses: current.addresses.filter((item) => item._id !== address._id) }));
              if (editing === address._id) { setEditing(null); setValues(empty); }
            }, 'Address deleted.');
          }}>Delete address</Button>
        </div>
      </li>)}
    </ul>
    <form className="space-y-3" onSubmit={saveAddress}>
      <h3 className="font-semibold">{editing ? 'Edit delivery address' : 'Add delivery address'}</h3>
      <AddressForm idPrefix="account-address" values={values} errors={errors} disabled={busy} onChange={(field, value) => setValues((previous) => ({ ...previous, [field]: value }))} />
      <fieldset className="grid gap-4" disabled={busy}>
        <legend className="mb-3 text-sm font-medium text-ink">Optional address details</legend>
        {optionalAddressFields.map(({ name: field, label, maxLength }) => <Input
          key={field} id={`account-address-${field}`} label={label} maxLength={maxLength}
          value={values[field] ?? ''} error={errors[field]}
          onChange={(event) => setValues((previous) => ({ ...previous, [field]: event.target.value }))}
        />)}
      </fieldset>
      <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={values.isDefault ?? false} disabled={busy} onChange={(event) => setValues((previous) => ({ ...previous, isDefault: event.target.checked }))} />Use as default address</label>
      <div className="flex flex-wrap gap-2"><Button type="submit" loading={busy} disabled={writeDisabled}>Save address</Button>
      {editing ? <Button type="button" variant="secondary" disabled={writeDisabled} onClick={() => { setEditing(null); setValues(empty); setErrors({}); }}>Add a new address</Button> : null}</div>
    </form>
  </div>;
}
