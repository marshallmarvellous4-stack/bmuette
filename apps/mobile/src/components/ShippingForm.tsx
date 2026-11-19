import React from 'react';
import { View } from 'react-native';
import { Field, Text } from './ui';
import type { Shipping } from '@/api/shop';

export type ShipState = Shipping;
export const emptyShipping: ShipState = { name: '', phone: '', line1: '', city: '', country: '' };

export function validateShipping(f: ShipState): Record<string, string> {
  const e: Record<string, string> = {};
  if (f.name.trim().length < 2) e.name = 'Who is it for?';
  if (f.phone.trim().length < 6) e.phone = 'Add a phone number for the courier.';
  if (f.line1.trim().length < 3) e.line1 = 'Add your street address.';
  if (f.city.trim().length < 2) e.city = 'Add your city.';
  if (f.country.trim().length !== 2) e.country = 'Two letters, like NG or GB.';
  return e;
}
export const cleanShipping = (f: ShipState): Shipping => ({ ...f, country: f.country.toUpperCase() });

export function ShippingForm({ value, onChange, errors }: { value: ShipState; onChange: (v: ShipState) => void; errors: Record<string, string> }) {
  const set = (k: keyof ShipState) => (v: string) => onChange({ ...value, [k]: v });
  return (
    <View style={{ gap: 14 }}>
      <Text variant="heading">Delivery</Text>
      <Field label="Full name" value={value.name} onChangeText={set('name')} autoCapitalize="words" error={errors.name} />
      <Field label="Phone" value={value.phone} onChangeText={set('phone')} keyboardType="phone-pad" error={errors.phone} />
      <Field label="Address" value={value.line1} onChangeText={set('line1')} autoCapitalize="words" error={errors.line1} />
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <View style={{ flex: 2 }}><Field label="City" value={value.city} onChangeText={set('city')} autoCapitalize="words" error={errors.city} /></View>
        <View style={{ flex: 1 }}><Field label="Country" value={value.country} onChangeText={set('country')} autoCapitalize="characters" maxLength={2} placeholder="NG" error={errors.country} /></View>
      </View>
    </View>
  );
}
