(function () {
  "use strict";

  var listEl = document.getElementById("links-list");
  var emptyEl = document.getElementById("empty-state");

  var WHATSAPP_ICON_SVG =
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' +
    '<path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.095 3.2 5.076 4.487.709.306 1.262.489 1.694.626.712.227 1.36.195 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>' +
    '<path d="M12.004 2C6.486 2 2 6.486 2 12.004c0 1.864.504 3.677 1.46 5.265L2 22l4.872-1.413a9.96 9.96 0 0 0 5.132 1.403h.004c5.518 0 10.004-4.486 10.004-10.004C22.012 6.486 17.522 2 12.004 2zm0 18.025h-.003a8.005 8.005 0 0 1-4.078-1.117l-.293-.174-3.024.877.85-2.949-.19-.303a8.001 8.001 0 0 1-1.27-4.355c0-4.422 3.598-8.02 8.014-8.02 2.14 0 4.151.835 5.665 2.351a7.967 7.967 0 0 1 2.347 5.671c-.001 4.421-3.6 8.019-8.018 8.019z"/>' +
    "</svg>";

  function getConfig() {
    var cfg = window.__CRM_RUNTIME_CONFIG__ || {};
    return {
      supabaseUrl: (cfg.supabaseUrl || "").replace(/\/$/, ""),
      anonKey: cfg.supabasePublishableKey || "",
    };
  }

  function resolveLogoUrl(logoUrl, supabaseUrl) {
    if (!logoUrl) return "";
    var url = logoUrl.trim();
    if (!url) return "";
    var base = (supabaseUrl || "").replace(/\/$/, "");
    var pathPart = url.split("?")[0];
    var query = url.indexOf("?") >= 0 ? url.slice(url.indexOf("?")) : "";

    if (/^https?:\/\//i.test(pathPart)) {
      var legacy = pathPart.match(/^https?:\/\/[^/]*supabase\.co(\/.*)$/i);
      if (legacy && base) return base + legacy[1] + query;
      var storageOther = pathPart.match(/^https?:\/\/[^/]+(\/storage\/v1\/.+)$/i);
      if (storageOther && base && pathPart.indexOf(base) !== 0) {
        return base + storageOther[1] + query;
      }
      return url;
    }
    if (pathPart.indexOf("/storage/") === 0 && base) {
      return base + pathPart + query;
    }
    return url;
  }

  function applyColors(bgColor, cardColor) {
    var root = document.documentElement;
    if (bgColor) root.style.setProperty("--pg-bg", bgColor);
    if (cardColor) root.style.setProperty("--pg-card", cardColor);
  }

  function injectMetaPixel(pixelId) {
    if (!pixelId) return;
    // Evita injeção dupla
    if (window.fbq) return;
    /* eslint-disable */
    !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
    n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
    n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
    t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}
    (window,document,'script','https://connect.facebook.net/en_US/fbevents.js');
    /* eslint-enable */
    window.fbq('init', pixelId);
    window.fbq('track', 'PageView');
    // noscript fallback
    var ns = document.createElement('noscript');
    var img = document.createElement('img');
    img.height = '1';
    img.width = '1';
    img.style.display = 'none';
    img.src = 'https://www.facebook.com/tr?id=' + encodeURIComponent(pixelId) + '&ev=PageView&noscript=1';
    ns.appendChild(img);
    document.body.appendChild(ns);
  }

  function appendWhatsappChannelButton(url) {
    if (!url) return;
    var a = document.createElement("a");
    a.className = "link-whatsapp-channel";
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.innerHTML = WHATSAPP_ICON_SVG + "<span>ACESSAR CANAL OFICIAL NO WHATSAPP</span>";
    listEl.appendChild(a);
  }

  function renderLinks(links, supabaseUrl, whatsappChannelUrl) {
    listEl.innerHTML = "";
    var hasAny = links && links.length > 0;
    if (!hasAny && !whatsappChannelUrl) {
      emptyEl.hidden = false;
      return;
    }
    emptyEl.hidden = true;

    links.forEach(function (link) {
      var type = link.link_type || "link";

      if (type === "header") {
        var h = document.createElement("p");
        h.className = "link-header";
        h.textContent = link.label || "";
        listEl.appendChild(h);
        return;
      }

      if (type === "banner") {
        var url = resolveLogoUrl(link.url || "", supabaseUrl);
        if (!url) return;
        var wrap = document.createElement("div");
        wrap.className = "link-banner";
        var img = document.createElement("img");
        img.src = url;
        img.alt = link.label || "";
        img.loading = "lazy";
        wrap.appendChild(img);
        listEl.appendChild(wrap);
        return;
      }

      if (type === "title") {
        var t = document.createElement("p");
        t.className = "link-title";
        t.textContent = link.label || "";
        listEl.appendChild(t);
        return;
      }

      if (type === "paragraph") {
        var p = document.createElement("p");
        p.className = "link-paragraph";
        p.textContent = link.label || "";
        listEl.appendChild(p);
        return;
      }

      // Default: link (pill button)
      var a = document.createElement("a");
      a.className = "link-item";
      a.href = link.url || "#";
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = link.label || "";
      listEl.appendChild(a);
    });

    appendWhatsappChannelButton(whatsappChannelUrl);
  }

  async function load() {
    var cfg = getConfig();
    if (!cfg.supabaseUrl || !cfg.anonKey) {
      renderLinks([], "");
      return;
    }
    try {
      var url = cfg.supabaseUrl + "/functions/v1/get-company-links";
      var res = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: "Bearer " + cfg.anonKey,
          apikey: cfg.anonKey,
        },
      });
      if (!res.ok) {
        renderLinks([], "");
        return;
      }
      var data = await res.json();

      var name = (data.system_name || "Joonker").replace(/^CRM\s+/i, "");
      document.title = name;

      applyColors(data.bg_color || "", data.card_color || "");
      injectMetaPixel(data.meta_pixel_id || "");

      var logoUrl = resolveLogoUrl(data.logo_url || "", cfg.supabaseUrl);
      if (logoUrl) {
        var favicon = document.getElementById("page-favicon");
        if (favicon) favicon.href = logoUrl;
      }

      renderLinks(data.links || [], cfg.supabaseUrl, data.whatsapp_channel_url || "");
    } catch (_err) {
      renderLinks([], "");
    }
  }

  load();
})();
