import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';

export type SmsPermissionState = 'prompt' | 'prompt-with-rationale' | 'granted' | 'denied';

export interface SmsInboxRow {
  id: string;
  address: string;
  body: string;
  date: number;
  read: boolean;
}

export interface SmsInboxPlugin {
  checkPermissions(): Promise<{ sms: SmsPermissionState }>;
  requestPermissions(): Promise<{ sms: SmsPermissionState }>;
  listInbox(options?: { limit?: number }): Promise<{ messages: SmsInboxRow[] }>;
  startListening(): Promise<void>;
  stopListening(): Promise<void>;
  addListener(
    eventName: 'smsReceived',
    listenerFunc: () => void,
  ): Promise<PluginListenerHandle>;
}

export const SmsInboxNative = registerPlugin<SmsInboxPlugin>('SmsInbox', {
  web: () => import('./smsInboxWeb').then(m => m.default),
});
