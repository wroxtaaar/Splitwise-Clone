package com.wroxtaaar.splits;

import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageInstaller;
import android.content.pm.PackageInfo;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;

/** Self-updater: checks a version.json, downloads the APK, verifies its SHA-256 and installs it. */
@CapacitorPlugin(name = "ApkUpdater")
public class ApkUpdater extends Plugin {
    private static final String ACTION = "com.wroxtaaar.splits.INSTALL_STATUS";
    private BroadcastReceiver receiver;

    private long installedCode() throws Exception {
        PackageInfo p = getContext().getPackageManager().getPackageInfo(getContext().getPackageName(), 0);
        return Build.VERSION.SDK_INT >= 28 ? p.getLongVersionCode() : p.versionCode;
    }

    private HttpURLConnection open(String url) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setInstanceFollowRedirects(true);
        c.setConnectTimeout(15000);
        c.setReadTimeout(30000);
        c.setRequestProperty("Cache-Control", "no-cache");
        return c;
    }

    @PluginMethod
    public void check(final PluginCall call) {
        final String url = call.getString("url");
        new Thread(() -> {
            try {
                HttpURLConnection c = open(url);
                if (c.getResponseCode() != 200) throw new Exception("HTTP " + c.getResponseCode());
                StringBuilder sb = new StringBuilder();
                try (BufferedReader r = new BufferedReader(new InputStreamReader(c.getInputStream()))) {
                    String line;
                    while ((line = r.readLine()) != null) sb.append(line);
                }
                JSONObject j = new JSONObject(sb.toString());
                JSObject out = new JSObject();
                out.put("installed", installedCode());
                out.put("latest", j.optLong("versionCode", 0));
                out.put("sha256", j.optString("sha256", ""));
                out.put("apk", j.optString("apk", "Expense.apk"));
                call.resolve(out);
            } catch (Exception e) {
                call.reject("check failed: " + e.getMessage());
            }
        }).start();
    }

    @PluginMethod
    public void install(final PluginCall call) {
        final String url = call.getString("url");
        final String sha = call.getString("sha256", "");
        final Context ctx = getContext();
        if (!ctx.getPackageManager().canRequestPackageInstalls()) {
            Intent i = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + ctx.getPackageName()));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(i);
            call.reject("needs_permission");
            return;
        }
        new Thread(() -> {
            try {
                File apk = new File(ctx.getCacheDir(), "update.apk");
                HttpURLConnection c = open(url);
                if (c.getResponseCode() != 200) throw new Exception("HTTP " + c.getResponseCode());
                MessageDigest md = MessageDigest.getInstance("SHA-256");
                try (InputStream in = c.getInputStream(); OutputStream out = new FileOutputStream(apk)) {
                    byte[] buf = new byte[65536];
                    int n;
                    while ((n = in.read(buf)) > 0) { out.write(buf, 0, n); md.update(buf, 0, n); }
                }
                StringBuilder hex = new StringBuilder();
                for (byte b : md.digest()) hex.append(String.format("%02x", b));
                if (!sha.isEmpty() && !hex.toString().equalsIgnoreCase(sha)) throw new Exception("checksum mismatch");

                PackageInstaller pi = ctx.getPackageManager().getPackageInstaller();
                PackageInstaller.SessionParams params = new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
                if (Build.VERSION.SDK_INT >= 31) params.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED);
                int id = pi.createSession(params);
                try (PackageInstaller.Session s = pi.openSession(id)) {
                    try (InputStream in = new FileInputStream(apk); OutputStream out = s.openWrite("expense.apk", 0, apk.length())) {
                        byte[] buf = new byte[65536];
                        int n;
                        while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                        s.fsync(out);
                    }
                    register(ctx);
                    Intent cb = new Intent(ACTION).setPackage(ctx.getPackageName());
                    int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0);
                    s.commit(PendingIntent.getBroadcast(ctx, id, cb, flags).getIntentSender());
                }
                call.resolve(new JSObject().put("started", true));
            } catch (Exception e) {
                call.reject("install failed: " + e.getMessage());
            }
        }).start();
    }

    private synchronized void register(final Context ctx) {
        if (receiver != null) return;
        receiver = new BroadcastReceiver() {
            @Override public void onReceive(Context context, Intent intent) {
                int status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, -1);
                if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
                    Intent confirm = intent.getParcelableExtra(Intent.EXTRA_INTENT);
                    if (confirm != null) {
                        confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        context.startActivity(confirm);
                    }
                } else if (status != PackageInstaller.STATUS_SUCCESS) {
                    JSObject o = new JSObject();
                    o.put("status", status);
                    o.put("message", intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE));
                    notifyListeners("installFailed", o);
                }
            }
        };
        IntentFilter f = new IntentFilter(ACTION);
        if (Build.VERSION.SDK_INT >= 33) ctx.registerReceiver(receiver, f, Context.RECEIVER_NOT_EXPORTED);
        else ctx.registerReceiver(receiver, f);
    }
}
