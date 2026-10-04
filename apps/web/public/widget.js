/**
 * Closer widget loader. Paste on any page:
 *   <script src="https://YOUR-CLOSER-HOST/widget.js" data-key="pk_..." async></script>
 *
 * Draws a chat button and, on first open, an iframe with /embed/<key> from the same host
 * this script came from. Everything else (chat, styles, who may frame it) lives in that
 * iframe, so nothing here touches the host page beyond these two elements.
 */
(function () {
  "use strict";
  var script = document.currentScript;
  if (!script) return;
  var key = script.getAttribute("data-key") || "";
  if (!/^pk_[0-9a-f]{32}$/.test(key)) {
    console.warn("[closer] widget.js: missing or invalid data-key");
    return;
  }
  var origin = new URL(script.src).origin;
  var label = script.getAttribute("data-label") || "Chat";
  var svgNs = "http://www.w3.org/2000/svg";

  var button = document.createElement("button");
  button.type = "button";
  button.setAttribute("aria-label", label);
  button.setAttribute("aria-expanded", "false");
  button.style.cssText =
    "position:fixed;right:20px;bottom:20px;z-index:2147483646;width:56px;height:56px;" +
    "display:flex;align-items:center;justify-content:center;border:0;border-radius:50%;" +
    "background:#18181b;color:#fff;cursor:pointer;box-shadow:0 4px 16px rgba(0,0,0,.25)";
  // Built with DOM calls, not innerHTML: nothing from the page is ever parsed as markup.
  var icon = document.createElementNS(svgNs, "svg");
  icon.setAttribute("width", "24");
  icon.setAttribute("height", "24");
  icon.setAttribute("viewBox", "0 0 24 24");
  icon.setAttribute("fill", "none");
  icon.setAttribute("stroke", "currentColor");
  icon.setAttribute("stroke-width", "2");
  icon.setAttribute("aria-hidden", "true");
  var path = document.createElementNS(svgNs, "path");
  path.setAttribute("d", "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z");
  icon.appendChild(path);
  button.appendChild(icon);

  var frame = null;
  var open = false;

  function place() {
    if (!frame) return;
    var small = window.innerWidth < 480;
    frame.style.cssText =
      "position:fixed;z-index:2147483647;border:0;background:#fff;" +
      "box-shadow:0 8px 32px rgba(0,0,0,.2);" +
      (small
        ? "inset:0;width:100%;height:100%;border-radius:0;"
        : "right:20px;bottom:88px;width:380px;height:560px;" +
          "max-height:calc(100vh - 108px);border-radius:12px;") +
      (open ? "" : "display:none;");
  }

  function toggle(next) {
    open = next;
    if (open && !frame) {
      frame = document.createElement("iframe");
      frame.src = origin + "/embed/" + key;
      frame.title = label;
      document.body.appendChild(frame);
    }
    button.setAttribute("aria-expanded", String(open));
    place();
    if (open && frame) frame.focus();
  }

  button.addEventListener("click", function () {
    toggle(!open);
  });
  window.addEventListener("resize", place);
  window.addEventListener("message", function (event) {
    // Only our own iframe may close it.
    if (event.origin !== origin || !frame || event.source !== frame.contentWindow) return;
    if (event.data && event.data.type === "closer:close") {
      toggle(false);
      button.focus();
    }
  });

  document.body.appendChild(button);
})();
