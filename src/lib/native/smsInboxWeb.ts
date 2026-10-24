import type { PluginListenerHandle } from '@capacitor/core';
import type { SmsInboxPlugin } from './smsInboxPlugin';

const unavailable = () => Promise.reject(new Error('SMS inbox is only available in the Android app'));

const SmsInboxWeb: SmsInboxPlugin = {
  checkPermissions: async () => ({ sms: 'denied' }),
  requestPermissions: async () => ({ sms: 'denied' }),
  listInbox: unavailable,
  startListening: unavailable,
  stopListening: async () => {},
  addListener: async () => ({ remove: async () => {} }) as PluginListenerHandle,
};

export default SmsInboxWeb;
