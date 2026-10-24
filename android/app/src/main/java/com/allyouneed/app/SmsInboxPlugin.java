package com.allyouneed.app;

import android.Manifest;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.Telephony;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;

@CapacitorPlugin(
    name = "SmsInbox",
    permissions = {
        @Permission(strings = { Manifest.permission.READ_SMS, Manifest.permission.RECEIVE_SMS }, alias = "sms")
    }
)
public class SmsInboxPlugin extends Plugin {

    private BroadcastReceiver smsReceiver;
    private boolean listening;

    @PluginMethod
    public void listInbox(PluginCall call) {
        if (!hasSmsPermission()) {
            call.reject("SMS permission not granted");
            return;
        }

        int limit = call.getInt("limit", 100);
        if (limit < 1) limit = 1;
        if (limit > 500) limit = 500;

        JSArray rows = new JSArray();
        Uri uri = Uri.parse("content://sms/inbox");
        String[] projection = new String[] { "_id", "address", "body", "date", "read" };
        String sort = "date DESC";

        try (Cursor cursor = getContext().getContentResolver().query(uri, projection, null, null, sort)) {
            if (cursor == null) {
                call.reject("Could not read SMS inbox");
                return;
            }
            int n = 0;
            while (cursor.moveToNext() && n < limit) {
                JSObject row = new JSObject();
                row.put("id", String.valueOf(cursor.getLong(cursor.getColumnIndexOrThrow("_id"))));
                row.put("address", cursor.getString(cursor.getColumnIndexOrThrow("address")));
                row.put("body", cursor.getString(cursor.getColumnIndexOrThrow("body")));
                row.put("date", cursor.getLong(cursor.getColumnIndexOrThrow("date")));
                row.put("read", cursor.getInt(cursor.getColumnIndexOrThrow("read")) == 1);
                rows.put(row);
                n++;
            }
        } catch (SecurityException e) {
            call.reject("SMS permission not granted");
            return;
        } catch (RuntimeException e) {
            call.reject("Could not read SMS inbox");
            return;
        }

        JSObject ret = new JSObject();
        ret.put("messages", rows);
        call.resolve(ret);
    }

    @PluginMethod
    public void startListening(PluginCall call) {
        if (!hasSmsPermission()) {
            call.reject("SMS permission not granted");
            return;
        }
        registerSmsReceiver();
        call.resolve();
    }

    @PluginMethod
    public void stopListening(PluginCall call) {
        unregisterSmsReceiver();
        call.resolve();
    }

    @Override
    protected void handleOnDestroy() {
        unregisterSmsReceiver();
        super.handleOnDestroy();
    }

    private boolean hasSmsPermission() {
        return ContextCompat.checkSelfPermission(getContext(), Manifest.permission.READ_SMS)
            == android.content.pm.PackageManager.PERMISSION_GRANTED;
    }

    private void registerSmsReceiver() {
        if (listening) return;
        smsReceiver =
            new BroadcastReceiver() {
                @Override
                public void onReceive(Context context, Intent intent) {
                    if (Telephony.Sms.Intents.SMS_RECEIVED_ACTION.equals(intent.getAction())) {
                        notifyListeners("smsReceived", new JSObject());
                    }
                }
            };
        IntentFilter filter = new IntentFilter(Telephony.Sms.Intents.SMS_RECEIVED_ACTION);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            ContextCompat.registerReceiver(getContext(), smsReceiver, filter, ContextCompat.RECEIVER_NOT_EXPORTED);
        } else {
            getContext().registerReceiver(smsReceiver, filter);
        }
        listening = true;
    }

    private void unregisterSmsReceiver() {
        if (!listening || smsReceiver == null) return;
        try {
            getContext().unregisterReceiver(smsReceiver);
        } catch (IllegalArgumentException ignored) {
            // Already gone.
        }
        smsReceiver = null;
        listening = false;
    }
}
