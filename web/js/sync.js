import { API, CLIENT_ID } from "./api.js";

/*
 * The server announces every change on /api/events. When someone else changes
 * something we re-render — unless this person is mid-typing, in which case the
 * dot turns orange and the refresh waits until they leave the field (or click the dot).
 */
export function createSync(onRefresh, onInvalidate = () => {}, onJob = () => {}) {
  const dot = document.getElementById("sync");
  let stale = false;
  let timer;
  let wasDown = false;
  let es = null;
  let retryTimer = null;
  const pendingPaths = new Set();
  let fullRefresh = false;

  const setDot = (state, title) => {
    dot.className = `sync ${state}`;
    dot.title = title;
    dot.setAttribute("aria-label", title);
  };
  const busy = () => {
    const a = document.activeElement;
    if (a && a.closest && a.closest("#view") && a.matches("input, textarea, select")) return true;
    return [...document.querySelectorAll("#view form input, #view form textarea")]
      .some((i) => i.type !== "hidden" && i.type !== "checkbox" && i.value !== i.defaultValue);
  };
  const tryRefresh = (force = false) => {
    if (!stale) return;
    if (!force && busy()) {
      setDot("live pending", "someone else made changes — click to load them");
      return;
    }
    stale = false;
    const paths = fullRefresh ? null : [...pendingPaths];
    pendingPaths.clear();
    fullRefresh = false;
    onInvalidate(paths);
    setDot("live", "live — changes from other devices appear automatically");
    onRefresh();
  };
  const refreshSoon = (path = null) => {
    stale = true;
    if (path) pendingPaths.add(path);
    else fullRefresh = true;
    clearTimeout(timer);
    timer = setTimeout(tryRefresh, 200);
  };
  /** Called by render(): whatever was pending is now on screen. */
  const markFresh = () => {
    if (!stale) return;
    stale = false;
    pendingPaths.clear();
    fullRefresh = false;
    if (dot.classList.contains("pending")) setDot("live", "live — changes from other devices appear automatically");
  };

  dot.addEventListener("click", () => tryRefresh(true));
  document.addEventListener("focusout", () => setTimeout(tryRefresh, 50));

  let retry = 1000;
  function disconnect() {
    clearTimeout(retryTimer);
    retryTimer = null;
    if (es) {
      es.close();
      es = null;
    }
    setDot("", "signed out");
  }
  function connect() {
    if (!window.EventSource || es) return;
    es = new EventSource(API + "/events");
    es.onopen = () => {
      retry = 1000;
      setDot("live", "live — changes from other devices appear automatically");
      if (wasDown) {
        wasDown = false;
        refreshSoon();
      }
    };
    es.onerror = () => {
      wasDown = true;
      setDot("", "offline — reconnecting…");
      // EventSource retries network drops itself, but gives up for good after
      // an error response (a proxy 502, say): then reconnect ourselves.
      if (es && es.readyState === EventSource.CLOSED) {
        es = null;
        retryTimer = setTimeout(connect, retry);
        retry = Math.min(retry * 2, 30000);
      }
    };
    es.onmessage = (e) => {
      let msg = {};
      try {
        msg = JSON.parse(e.data) || {};
      } catch {
        /* keep-alive */
      }
      if (msg.type === "job") {
        onJob(msg);
        return;
      }
      if (msg.by !== CLIENT_ID) refreshSoon(msg.path || null);
    };
  }
  return { connect, disconnect, refreshSoon, markFresh };
}
