(function () {
  "use strict";

  var script = document.currentScript;
  var apiBase = script && script.src ? new URL(".", script.src).origin : "";

  function BerserkEngine(options) {
    options = options || {};
    this.onStatus = typeof options.onStatus === "function" ? options.onStatus : function () {};
    this.onInfo = typeof options.onInfo === "function" ? options.onInfo : function () {};
    this.onError = typeof options.onError === "function" ? options.onError : function () {};
    this.stopped = false;
    var self = this;

    this.onStatus("loading");
    this.ready = (async function () {
      if (!apiBase) throw new Error("Could not determine the Berserk API origin from client.js.");
      var response = await fetch(new URL("/health", apiBase), {
        method: "GET",
        cache: "no-store",
        credentials: "omit"
      });
      if (!response.ok) throw new Error("Berserk API health check failed (HTTP " + response.status + ").");
      var health = await response.json();
      if (health.status !== "ok") throw new Error("Berserk API did not report a healthy status.");
      self.onStatus("ready");
      return self;
    })().catch(function (error) {
      self.onStatus("error");
      self.onError(error);
      throw error;
    });
  }

  BerserkEngine.prototype.search = async function (fen, milliseconds, multiPV, context) {
    await this.ready;
    if (this.stopped) throw new Error("Berserk API client has been stopped.");

    var response = await fetch(new URL("/api/analyze", apiBase), {
      method: "POST",
      mode: "cors",
      credentials: "omit",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fen: String(fen),
        think_time_ms: Math.max(100, Math.min(10000, Math.round(Number(milliseconds) || 1000))),
        multi_pv: Math.max(1, Math.min(8, Math.round(Number(multiPV) || 1))),
        threads: 1,
        context: context === undefined ? null : context
      })
    });

    var result;
    try {
      result = await response.json();
    } catch (_) {
      result = {};
    }
    if (!response.ok) {
      throw new Error(result.detail || ("Berserk API search failed (HTTP " + response.status + ")."));
    }
    if (!result.bestmove) throw new Error("Berserk API returned no best move.");
    return result;
  };

  BerserkEngine.prototype.terminate = function () {
    this.stopped = true;
  };

  // Keeps the same global interface expected by Berserk-web's existing app.js.
  window.BerserkEngine = BerserkEngine;
})();
