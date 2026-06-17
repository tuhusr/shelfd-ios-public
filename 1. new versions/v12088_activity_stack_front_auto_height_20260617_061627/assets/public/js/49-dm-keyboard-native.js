/*
   49-dm-keyboard-native.js
   v11.883 — Native iOS keyboard tuning for the DM chat, via the Capacitor Keyboard plugin
   (@capacitor/keyboard). FEATURE-DETECTED: a complete no-op on web / Android / any iOS build that
   does not bundle the plugin, so it can never break those targets.

   WHY: the chat HEADER drifts/jumps toward the middle of the screen (with a dark strip above it)
   while the iOS keyboard opens. That is iOS auto-scrolling the focused composer input into view —
   it PANS the visual viewport (visualViewport.offsetTop spikes), and any compensation we apply to
   the position:fixed panel jostles the header along with it. The WEB layer cannot stop that pan
   (position:fixed is anchored to the layout viewport, which the pan moves). The supported fix is
   `Keyboard.setScroll({ isDisabled: true })`, which tells WKWebView NOT to scroll to the focused
   input. We scope it to the DM page (disable on open, restore on close) so every other page keeps
   its normal scroll-into-view behaviour.

   REQUIRES @capacitor/keyboard in the iOS app binary. If it isn't present:
     npm i @capacitor/keyboard   →   npx cap sync ios   →   rebuild / re-archive in Xcode.
   (These methods are iOS-only and are no-ops on iOS 13.)
*/
(function () {
  function dmKb() {
    try {
      return (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Keyboard) || null;
    } catch (_) { return null; }
  }

  /* Disable the native scroll-to-input PAN while the DM page is open (keeps the fixed chat header
     pinned); restore it on close. No-op without the plugin. */
  window.dmSetKeyboardScrollDisabled = function (disabled) {
    const K = dmKb();
    if (K && typeof K.setScroll === 'function') {
      try { K.setScroll({ isDisabled: !!disabled }); } catch (_) {}
    }
  };

  /* Hide the iOS input-accessory bar (the up/down/Done toolbar) so the composer can sit directly
     above the predictive-text row. Wired up by the composer-placement update. No-op without the
     plugin / on iOS 13. */
  window.dmSetKeyboardAccessoryBarVisible = function (visible) {
    const K = dmKb();
    if (K && typeof K.setAccessoryBarVisible === 'function') {
      try { K.setAccessoryBarVisible({ isVisible: !!visible }); } catch (_) {}
    }
  };

  /* True once a Keyboard plugin is actually present in this build — lets the report / diagnostics
     tell whether the native fix is live or still needs an Xcode rebuild. */
  window.dmKeyboardPluginAvailable = function () { return !!dmKb(); };

  /* v12.038: generic aliases so any fixed-composer surface (DM chat, the feed
     comment sheet, …) can disable the native scroll-to-input PAN and hide the
     input-accessory bar without each one reaching for the plugin itself. Same
     no-op-without-plugin guarantee. */
  window.shelfdSetKeyboardScrollDisabled = window.dmSetKeyboardScrollDisabled;
  window.shelfdSetKeyboardAccessoryBarVisible = window.dmSetKeyboardAccessoryBarVisible;
})();
