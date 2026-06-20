(function () {
  "use strict";

  var form = document.getElementById("copa-form");
  var errorEl = document.getElementById("form-error");
  var successEl = document.getElementById("success-screen");
  var btnSubmit = document.getElementById("btn-submit");
  var btnClear = document.getElementById("btn-clear");
  var cpfInput = document.getElementById("cpf");
  var cpfErrorEl = document.getElementById("cpf-error");
  var telefoneInput = document.getElementById("telefone");
  var periodNoticeEl = document.getElementById("period-notice");
  var estadoSelect = document.getElementById("estado");
  var cidadeSelect = document.getElementById("cidade_municipio");
  var cidadeErrorEl = document.getElementById("cidade-error");
  var sintomasErrorEl = document.getElementById("sintomas-error");
  var sintomasCheckboxes = document.querySelectorAll('input[name="sintomas"]');

  var currentJogoKey = "";
  var pixelSuccessSnippet = "";
  var pixelFormInjected = false;
  var pixelSuccessInjected = false;
  var periodoAberto = true;
  var periodoMensagem = "";

  // Injeta um snippet HTML/JS no documento. Scripts precisam ser re-criados
  // porque innerHTML não executa <script> automaticamente.
  function injectSnippet(html) {
    if (!html || !html.trim()) return;
    var tmp = document.createElement("div");
    tmp.innerHTML = html;

    tmp.querySelectorAll("script").forEach(function (old) {
      var s = document.createElement("script");
      Array.from(old.attributes).forEach(function (a) { s.setAttribute(a.name, a.value); });
      if (!old.src) s.textContent = old.textContent;
      document.head.appendChild(s);
    });

    tmp.querySelectorAll("noscript").forEach(function (ns) {
      document.body.appendChild(ns.cloneNode(true));
    });
  }

  function injectFormPixel(snippet) {
    if (!snippet || pixelFormInjected) return;
    pixelFormInjected = true;
    injectSnippet(snippet);
  }

  function injectSuccessPixel() {
    if (!pixelSuccessSnippet || pixelSuccessInjected) return;
    pixelSuccessInjected = true;
    injectSnippet(pixelSuccessSnippet);
  }

  function getConfig() {
    var cfg = window.__CRM_RUNTIME_CONFIG__ || {};
    return {
      supabaseUrl: (cfg.supabaseUrl || "").replace(/\/$/, ""),
      anonKey: cfg.supabasePublishableKey || "",
    };
  }

  function flagUrl(code) {
    var c = (code || "xx").toLowerCase().replace(/[^a-z-]/g, "").slice(0, 6);
    return "https://flagcdn.com/w40/" + c + ".png";
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

  var CAMPAIGN_TITLE = "BOLÃO DA COPA JOONKER";

  function displayBrandName(raw) {
    var name = (raw || "Óticas Joonker").trim();
    return name.replace(/^CRM\s+/i, "");
  }

  function formatTeamLabel(name) {
    var n = String(name || "").trim();
    if (!n) return "—";
    var words = n.split(/\s+/).filter(Boolean);
    if (words.length >= 2) return words.join("\n");
    if (n.length > 9) {
      var mid = Math.ceil(n.length / 2);
      return n.slice(0, mid) + "\n" + n.slice(mid);
    }
    return n;
  }

  function applyTeamLabel(el, name) {
    if (!el) return;
    el.textContent = formatTeamLabel(name);
    el.title = name;
  }

  function applyPublicConfig(data, supabaseUrl) {
    var brandName = displayBrandName(data.system_name);
    var jogoLabel = data.jogo_label || "Brasil x Marrocos";
    var logoUrl = resolveLogoUrl(data.logo_url || "", supabaseUrl);
    var bannerUrl = resolveLogoUrl(data.banner_url || "", supabaseUrl);
    var homeName = data.team_home_name || "Brasil";
    var awayName = data.team_away_name || "Marrocos";
    var homeFlag = data.team_home_flag || "br";
    var awayFlag = data.team_away_flag || "ma";
    var matchMeta = data.match_meta || "";

    currentJogoKey = data.jogo_key || "";
    pixelSuccessSnippet = data.pixel_success || "";
    injectFormPixel(data.pixel_form || "");
    setFormPeriodState(data.periodo_aberto, data.periodo_mensagem || "");

    document.title = CAMPAIGN_TITLE;

    var titleEl = document.getElementById("campaign-title");
    if (titleEl) titleEl.textContent = CAMPAIGN_TITLE;

    ["jogo-label", "palpite-jogo-label"].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.textContent = jogoLabel;
    });

    ["consent-brand", "footer-brand"].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.textContent = brandName;
    });

    var metaEl = document.getElementById("match-meta");
    if (metaEl) {
      metaEl.textContent = matchMeta;
      metaEl.hidden = !matchMeta;
    }

    var homeLabel = document.getElementById("team-home-label");
    var awayLabel = document.getElementById("team-away-label");
    applyTeamLabel(homeLabel, homeName);
    applyTeamLabel(awayLabel, awayName);

    var homeFlagEl = document.getElementById("team-home-flag");
    var awayFlagEl = document.getElementById("team-away-flag");
    if (homeFlagEl) {
      homeFlagEl.src = flagUrl(homeFlag);
      homeFlagEl.alt = homeName;
    }
    if (awayFlagEl) {
      awayFlagEl.src = flagUrl(awayFlag);
      awayFlagEl.alt = awayName;
    }

    if (bannerUrl) {
      var heroBanner = document.getElementById("hero-banner");
      var hero = document.querySelector(".hero");
      if (heroBanner) {
        heroBanner.src = bannerUrl;
        heroBanner.hidden = false;
      }
      if (hero) hero.classList.add("hero--has-banner");
    }

    if (logoUrl) {
      var favicon = document.getElementById("page-favicon");
      if (favicon) favicon.href = logoUrl;

      var heroLogo = document.getElementById("hero-logo");
      if (heroLogo) {
        heroLogo.src = logoUrl;
        heroLogo.alt = brandName;
        heroLogo.hidden = false;
      }
    }

    applySuccessConfig(data, supabaseUrl);
  }

  function applySuccessConfig(data, supabaseUrl) {
    var imageUrl = resolveLogoUrl(data.success_image_url || "", supabaseUrl);
    var title = data.success_title || "";
    var subtitle = data.success_subtitle || "";
    var instagramUrl = (data.success_instagram_url || "").trim();
    var buttonLabel = data.success_button_label || "Participe do canal";

    var successImage = document.getElementById("success-image");
    if (successImage) {
      if (imageUrl) {
        successImage.src = imageUrl;
        successImage.alt = "Campanha Copa";
        successImage.hidden = false;
      } else {
        successImage.hidden = true;
        successImage.removeAttribute("src");
      }
    }

    var promoTitle = document.getElementById("success-promo-title");
    var promoSubtitle = document.getElementById("success-promo-subtitle");
    var btnInstagram = document.getElementById("btn-instagram");
    var promoBlock = document.getElementById("success-promo");

    if (promoTitle) promoTitle.textContent = title;
    if (promoSubtitle) promoSubtitle.textContent = subtitle;

    if (btnInstagram) {
      btnInstagram.textContent = buttonLabel;
      if (instagramUrl) {
        btnInstagram.href = instagramUrl;
        btnInstagram.hidden = false;
      } else {
        btnInstagram.hidden = true;
      }
    }

    if (promoBlock) {
      promoBlock.hidden = !(title || subtitle || instagramUrl);
    }
  }

  async function loadPublicConfig() {
    var cfg = getConfig();
    if (!cfg.supabaseUrl || !cfg.anonKey) return;

    try {
      var url = cfg.supabaseUrl + "/functions/v1/submit-campanha-copa";
      var res = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: "Bearer " + cfg.anonKey,
          apikey: cfg.anonKey,
        },
      });
      if (!res.ok) return;
      var data = await res.json();
      applyPublicConfig(data, cfg.supabaseUrl);
    } catch (_err) {
      /* mantém defaults */
    }
  }

  function showError(msg) {
    errorEl.textContent = msg;
    errorEl.hidden = false;
    errorEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function hideError() {
    errorEl.hidden = true;
    errorEl.textContent = "";
  }

  function trackEvent(name, params) {
    if (typeof window.fbq === "function") {
      window.fbq("track", name, params || {});
    }
    if (typeof window.gtag === "function") {
      window.gtag("event", name, params || {});
    }
    if (typeof window.dataLayer !== "undefined") {
      window.dataLayer.push({ event: name, ...(params || {}) });
    }
  }

  var cidadesPorEstado = {};
  var municipiosCarregados = false;

  function setCidadeSelectState(message, disabled) {
    if (!cidadeSelect) return;
    cidadeSelect.innerHTML = "";
    var opt = document.createElement("option");
    opt.value = "";
    opt.textContent = message;
    cidadeSelect.appendChild(opt);
    cidadeSelect.disabled = disabled;
  }

  function showCidadeError(msg) {
    if (!cidadeErrorEl) return;
    if (msg) {
      cidadeErrorEl.textContent = msg;
      cidadeErrorEl.hidden = false;
    } else {
      cidadeErrorEl.hidden = true;
      cidadeErrorEl.textContent = "";
    }
  }

  function populateCidadeSelect(nomes) {
    cidadeSelect.innerHTML = "";
    var placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Cidade";
    cidadeSelect.appendChild(placeholder);
    nomes.forEach(function (nome) {
      var opt = document.createElement("option");
      opt.value = nome;
      opt.textContent = nome;
      cidadeSelect.appendChild(opt);
    });
    cidadeSelect.disabled = false;
  }

  function loadCidadesForEstado(uf) {
    if (!cidadeSelect) return;
    showCidadeError("");

    if (!uf) {
      setCidadeSelectState("Selecione o estado", true);
      return;
    }

    if (cidadesPorEstado[uf]) {
      populateCidadeSelect(cidadesPorEstado[uf]);
      return;
    }

    if (municipiosCarregados) {
      setCidadeSelectState("Nenhuma cidade encontrada", true);
      return;
    }

    setCidadeSelectState("Carregando cidades...", true);

    fetch("/campanha-copa/municipios.json")
      .then(function (res) {
        if (!res.ok) throw new Error("Falha");
        return res.json();
      })
      .then(function (data) {
        cidadesPorEstado = data || {};
        municipiosCarregados = true;
        if (cidadesPorEstado[uf]) {
          populateCidadeSelect(cidadesPorEstado[uf]);
        } else {
          setCidadeSelectState("Nenhuma cidade encontrada", true);
        }
      })
      .catch(function () {
        setCidadeSelectState("Erro ao carregar cidades", true);
        showCidadeError("Não foi possível carregar as cidades. Tente recarregar a página.");
      });
  }

  // Pré-carrega o JSON de municípios ao iniciar para agilizar a seleção
  fetch("/campanha-copa/municipios.json")
    .then(function (res) { return res.ok ? res.json() : null; })
    .then(function (data) { if (data) { cidadesPorEstado = data; municipiosCarregados = true; } })
    .catch(function () { /* fallback silencioso — será tentado ao selecionar estado */ });

  if (estadoSelect) {
    estadoSelect.addEventListener("change", function () {
      loadCidadesForEstado(estadoSelect.value);
    });
  }

  function getRadioValue(name) {
    var checked = form.querySelector('input[name="' + name + '"]:checked');
    return checked ? checked.value : "";
  }

  function getCheckboxValues(name) {
    var checked = form.querySelectorAll('input[name="' + name + '"]:checked');
    return Array.from(checked).map(function (el) {
      return el.value;
    });
  }

  function showSintomasError(msg) {
    if (!sintomasErrorEl) return;
    if (msg) {
      sintomasErrorEl.textContent = msg;
      sintomasErrorEl.hidden = false;
    } else {
      sintomasErrorEl.hidden = true;
      sintomasErrorEl.textContent = "";
    }
  }

  function validateSintomasField() {
    if (getCheckboxValues("sintomas").length === 0) {
      showSintomasError("Selecione ao menos uma opção (ou \"Nenhum Sintoma\").");
      return false;
    }
    showSintomasError("");
    return true;
  }

  Array.from(sintomasCheckboxes).forEach(function (el) {
    el.addEventListener("change", function () {
      if (getCheckboxValues("sintomas").length > 0) {
        showSintomasError("");
      }
    });
  });

  function maskCpf(value) {
    var d = (value || "").replace(/\D/g, "").slice(0, 11);
    if (d.length <= 3) return d;
    if (d.length <= 6) return d.slice(0, 3) + "." + d.slice(3);
    if (d.length <= 9) return d.slice(0, 3) + "." + d.slice(3, 6) + "." + d.slice(6);
    return d.slice(0, 3) + "." + d.slice(3, 6) + "." + d.slice(6, 9) + "-" + d.slice(9);
  }

  function cleanCpf(value) {
    return (value || "").replace(/\D/g, "");
  }

  function maskTelefone(value) {
    var d = (value || "").replace(/\D/g, "").slice(0, 11);
    if (d.length === 0) return "";
    if (d.length <= 2) return "(" + d;
    if (d.length <= 6) return "(" + d.slice(0, 2) + ") " + d.slice(2);
    if (d.length <= 10) return "(" + d.slice(0, 2) + ") " + d.slice(2, 6) + "-" + d.slice(6);
    return "(" + d.slice(0, 2) + ") " + d.slice(2, 7) + "-" + d.slice(7);
  }

  function isValidCpf(cpf) {
    if (!cpf || cpf.length !== 11) return false;
    if (/^(\d)\1+$/.test(cpf)) return false;
    var sum = 0;
    var i;
    for (i = 0; i < 9; i++) sum += Number(cpf[i]) * (10 - i);
    var d1 = (sum * 10) % 11;
    if (d1 === 10) d1 = 0;
    if (d1 !== Number(cpf[9])) return false;
    sum = 0;
    for (i = 0; i < 10; i++) sum += Number(cpf[i]) * (11 - i);
    var d2 = (sum * 10) % 11;
    if (d2 === 10) d2 = 0;
    return d2 === Number(cpf[10]);
  }

  function showCpfError(msg) {
    if (!cpfErrorEl || !cpfInput) return;
    if (msg) {
      cpfErrorEl.textContent = msg;
      cpfErrorEl.hidden = false;
      cpfInput.classList.add("input-invalid");
      cpfInput.setCustomValidity(msg);
    } else {
      cpfErrorEl.hidden = true;
      cpfErrorEl.textContent = "";
      cpfInput.classList.remove("input-invalid");
      cpfInput.setCustomValidity("");
    }
  }

  function validateCpfField() {
    if (!cpfInput) return true;
    var cpf = cleanCpf(cpfInput.value);
    if (!cpf) {
      showCpfError("Informe seu CPF.");
      return false;
    }
    if (cpf.length !== 11) {
      showCpfError("O CPF deve ter 11 dígitos.");
      return false;
    }
    if (!isValidCpf(cpf)) {
      showCpfError("CPF inválido. Verifique os números digitados.");
      return false;
    }
    showCpfError("");
    return true;
  }

  function setFormPeriodState(aberto, mensagem) {
    periodoAberto = aberto !== false;
    periodoMensagem = mensagem || "";

    if (periodNoticeEl) {
      if (!periodoAberto && periodoMensagem) {
        periodNoticeEl.textContent = periodoMensagem;
        periodNoticeEl.hidden = false;
        periodNoticeEl.classList.add("period-notice--closed");
      } else if (periodoMensagem) {
        periodNoticeEl.textContent = periodoMensagem;
        periodNoticeEl.hidden = false;
        periodNoticeEl.classList.remove("period-notice--closed");
      } else {
        periodNoticeEl.hidden = true;
        periodNoticeEl.textContent = "";
        periodNoticeEl.classList.remove("period-notice--closed");
      }
    }

    var disabled = !periodoAberto;
    if (form) {
      Array.from(form.elements).forEach(function (el) {
        if (el && "disabled" in el) el.disabled = disabled;
      });
    }
    if (cidadeSelect && !(estadoSelect && estadoSelect.value)) {
      cidadeSelect.disabled = true;
    }
    if (btnClear) btnClear.disabled = disabled;
    if (btnSubmit) {
      btnSubmit.disabled = disabled;
      btnSubmit.textContent = disabled ? "Período encerrado" : "Enviar";
    }
  }

  function collectPayload() {
    var uf = (estadoSelect && estadoSelect.value) || "";
    var municipio = (cidadeSelect && cidadeSelect.value) || "";
    return {
      jogo_key: currentJogoKey,
      nome: document.getElementById("nome").value.trim(),
      cpf: document.getElementById("cpf").value.trim(),
      idade: document.getElementById("idade").value.replace(/\D/g, ""),
      cidade: municipio && uf ? municipio + "/" + uf : municipio || uf,
      telefone: document.getElementById("telefone").value.trim(),
      usa_oculos: getRadioValue("usa_oculos"),
      sintomas: getCheckboxValues("sintomas"),
      doencas: getCheckboxValues("doencas"),
      ultimo_exame_vista: document.getElementById("ultimo_exame_vista").value,
      palpite_home: parseInt(document.getElementById("palpite_home").value, 10),
      palpite_away: parseInt(document.getElementById("palpite_away").value, 10),
      consentimento_marketing: document.getElementById("consentimento_marketing").checked,
    };
  }

  async function submitForm(ev) {
    ev.preventDefault();
    hideError();

    if (!periodoAberto) {
      showError(periodoMensagem || "O período para envio de palpites está encerrado.");
      return;
    }

    if (!validateCpfField()) {
      cpfInput.focus();
      return;
    }

    if (!validateSintomasField()) {
      if (sintomasErrorEl) sintomasErrorEl.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }

    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }

    var cfg = getConfig();
    if (!cfg.supabaseUrl || !cfg.anonKey) {
      showError("Configuração do servidor indisponível. Tente novamente mais tarde.");
      return;
    }

    if (!currentJogoKey) {
      await loadPublicConfig();
      if (!currentJogoKey) {
        showError("Não foi possível carregar o jogo. Recarregue a página.");
        return;
      }
    }

    var payload = collectPayload();
    btnSubmit.disabled = true;
    btnSubmit.textContent = "Enviando...";

    trackEvent("Lead", { content_name: "Campanha Copa", status: "submitting" });

    try {
      var url = cfg.supabaseUrl + "/functions/v1/submit-campanha-copa";
      var res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + cfg.anonKey,
          apikey: cfg.anonKey,
        },
        body: JSON.stringify(payload),
      });

      var data = await res.json().catch(function () { return {}; });

      if (!res.ok) {
        throw new Error(data.error || "Não foi possível enviar. Tente novamente.");
      }

      trackEvent("CompleteRegistration", {
        content_name: "Campanha Copa",
        palpite: payload.palpite_home + "x" + payload.palpite_away,
      });

      form.hidden = true;
      successEl.hidden = false;
      var heroEl = document.querySelector(".hero");
      if (heroEl) heroEl.hidden = true;
      injectSuccessPixel();
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      showError(err.message || "Erro ao enviar. Tente novamente.");
      trackEvent("Lead", { content_name: "Campanha Copa", status: "error" });
    } finally {
      btnSubmit.disabled = !periodoAberto;
      btnSubmit.textContent = periodoAberto ? "Enviar" : "Período encerrado";
    }
  }

  function clearForm() {
    form.reset();
    setCidadeSelectState("Selecione o estado", true);
    showCidadeError("");
    hideError();
    trackEvent("CustomizeProduct", { content_name: "Campanha Copa", action: "clear" });
  }

  if (cpfInput) {
    cpfInput.addEventListener("input", function () {
      cpfInput.value = maskCpf(cpfInput.value);
      if (cleanCpf(cpfInput.value).length === 11) validateCpfField();
      else showCpfError("");
    });
    cpfInput.addEventListener("blur", validateCpfField);
  }

  if (telefoneInput) {
    telefoneInput.addEventListener("input", function () {
      telefoneInput.value = maskTelefone(telefoneInput.value);
    });
  }

  form.addEventListener("submit", submitForm);
  btnClear.addEventListener("click", clearForm);

  var regulamentoModal = document.getElementById("regulamento-modal");
  var regulamentoBackdrop = document.getElementById("regulamento-backdrop");
  var btnRegulamento = document.getElementById("btn-regulamento");
  var btnRegulamentoFooter = document.getElementById("btn-regulamento-footer");
  var btnRegulamentoClose = document.getElementById("regulamento-close");
  var btnRegulamentoCloseBottom = document.getElementById("regulamento-close-bottom");

  function openRegulamento() {
    if (!regulamentoModal) return;
    regulamentoModal.hidden = false;
    regulamentoModal.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
    trackEvent("ViewContent", { content_name: "Campanha Copa Regulamento" });
  }

  function closeRegulamento() {
    if (!regulamentoModal) return;
    regulamentoModal.hidden = true;
    regulamentoModal.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
  }

  if (btnRegulamento) btnRegulamento.addEventListener("click", openRegulamento);
  if (btnRegulamentoFooter) btnRegulamentoFooter.addEventListener("click", openRegulamento);
  if (btnRegulamentoClose) btnRegulamentoClose.addEventListener("click", closeRegulamento);
  if (btnRegulamentoCloseBottom) btnRegulamentoCloseBottom.addEventListener("click", closeRegulamento);
  if (regulamentoBackdrop) regulamentoBackdrop.addEventListener("click", closeRegulamento);

  document.addEventListener("keydown", function (ev) {
    if (ev.key === "Escape" && regulamentoModal && !regulamentoModal.hidden) {
      closeRegulamento();
    }
  });

  void loadPublicConfig();
  trackEvent("ViewContent", { content_name: "Campanha Copa" });
})();
