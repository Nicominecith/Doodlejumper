package com.nico.doodlejumper

import android.annotation.SuppressLint
import android.app.UiModeManager
import android.content.pm.ActivityInfo
import android.content.res.Configuration
import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import com.google.android.gms.ads.AdError
import com.google.android.gms.ads.AdRequest
import com.google.android.gms.ads.FullScreenContentCallback
import com.google.android.gms.ads.LoadAdError
import com.google.android.gms.ads.MobileAds
import com.google.android.gms.ads.rewarded.RewardedAd
import com.google.android.gms.ads.rewarded.RewardedAdLoadCallback

// Trage hier deine Adressen ein
private const val START_URL = "https://doodlejumper.netlify.app/app"   // oder "file:///android_asset/App.html"
private const val UNIT_REVIVE = "ca-app-pub-4209351244073154/4468490868"  // Weiterspielen
private const val UNIT_COINS = "ca-app-pub-4209351244073154/9270225553"   // +50 Gold

class MainActivity : AppCompatActivity() {
    private lateinit var web: WebView
    private val ads = mutableMapOf<String, RewardedAd?>()
    private fun unit(kind: String) = if (kind == "coins") UNIT_COINS else UNIT_REVIVE

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Handy: Hochformat. Tablet und TV: Drehen bzw. Querformat erlaubt.
        val isTv = (getSystemService(UI_MODE_SERVICE) as UiModeManager).currentModeType == Configuration.UI_MODE_TYPE_TELEVISION
        val isTablet = resources.configuration.smallestScreenWidthDp >= 600
        requestedOrientation = if (isTv || isTablet) ActivityInfo.SCREEN_ORIENTATION_FULL_SENSOR else ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
        WindowCompat.setDecorFitsSystemWindows(window, false)
        WindowInsetsControllerCompat(window, window.decorView).apply {
            hide(WindowInsetsCompat.Type.systemBars())
            systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        }

        MobileAds.initialize(this) {}
        loadRewarded("revive")
        loadRewarded("coins")

        web = WebView(this)
        web.settings.javaScriptEnabled = true
        web.settings.domStorageEnabled = true
        web.settings.mediaPlaybackRequiresUserGesture = false
        web.overScrollMode = WebView.OVER_SCROLL_NEVER
        web.addJavascriptInterface(Bridge(), "AndroidAds")
        setContentView(web)
        web.isFocusable = true
        web.isFocusableInTouchMode = true
        web.requestFocus()
        web.loadUrl(if (isTv) START_URL + "?tv=1" else START_URL)  // ?tv=1 schaltet die Fernbedienungs-Steuerung ein

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                web.evaluateJavascript("window.appBack&&window.appBack()") { r ->
                    if (r != "true") finish()
                }
            }
        })
    }

    private fun js(code: String) = runOnUiThread { web.evaluateJavascript(code, null) }

    private fun loadRewarded(kind: String) {
        RewardedAd.load(this, unit(kind), AdRequest.Builder().build(), object : RewardedAdLoadCallback() {
            override fun onAdLoaded(ad: RewardedAd) { ads[kind] = ad }
            override fun onAdFailedToLoad(e: LoadAdError) { ads[kind] = null }
        })
    }

    inner class Bridge {
        @JavascriptInterface
        fun showRewarded(kind: String) {
            runOnUiThread {
                val ad = ads[kind]
                if (ad == null) { js("onRewardedFail()"); loadRewarded(kind); return@runOnUiThread }
                var earned = false
                ad.fullScreenContentCallback = object : FullScreenContentCallback() {
                    override fun onAdDismissedFullScreenContent() {
                        ads[kind] = null
                        loadRewarded(kind)
                        if (earned) js("onRewardedDone()")
                    }
                    override fun onAdFailedToShowFullScreenContent(e: AdError) {
                        ads[kind] = null
                        loadRewarded(kind)
                        js("onRewardedFail()")
                    }
                }
                ad.show(this@MainActivity) { earned = true }
            }
        }
    }

    override fun onResume() { super.onResume(); web.onResume() }
    override fun onPause() { web.onPause(); super.onPause() }
}
