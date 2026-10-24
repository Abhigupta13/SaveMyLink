'use client';

import { isNativeApp } from '@/lib/nativeBridge';
import { SmsInboxNative, type SmsInboxRow, type SmsPermissionState } from './smsInboxPlugin';

export type { SmsInboxRow };

export async function smsInboxAvailable(): Promise<boolean> {
  return isNativeApp();
}

export async function getSmsPermission(): Promise<SmsPermissionState> {
  if (!(await isNativeApp())) return 'denied';
  const { sms } = await SmsInboxNative.checkPermissions();
  return sms;
}

export async function requestSmsPermission(): Promise<SmsPermissionState> {
  if (!(await isNativeApp())) return 'denied';
  const { sms } = await SmsInboxNative.requestPermissions();
  return sms;
}

export async function listSmsInbox(limit = 100): Promise<SmsInboxRow[]> {
  const { messages } = await SmsInboxNative.listInbox({ limit });
  return messages || [];
}

export async function listenForNewSms(onRefresh: () => void): Promise<() => void> {
  await SmsInboxNative.startListening();
  const handle = await SmsInboxNative.addListener('smsReceived', onRefresh);
  return async () => {
    await handle.remove();
    await SmsInboxNative.stopListening().catch(() => {});
  };
}
