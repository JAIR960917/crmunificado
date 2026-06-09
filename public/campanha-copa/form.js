(function () {
  "use strict";

  var form = document.getElementById("copa-form");
  var errorEl = document.getElementById("form-error");
  var successEl = document.getElementById("success-screen");
  var btnSubmit = document.getElementById("btn-submit");
  var btnClear = document.getElementById("btn-clear");

  function getConfig() {
    var cfg = window.__CRM_RUNTIME_CONFIG__ || {};
    return {
      supabaseUrl: (cfg.supabaseUrl || "").replace(/\/$/, ""),
      anonKey: cfg.supabasePublishableKey || "",
    };
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

  function getRadioValue(name) {
    var checked = form.querySelector('input[name="' + name + '"]:checked');
    return checked ? checked.value : "";
  }

  function collectPayload() {
    return {
      nome: document.getElementById("nome").value.trim(),
      idade: document.getElementById("idade").value.trim(),
      cidade: document.getElementById("cidade").value.trim(),
      telefone: document.getElementById("telefone").value.trim(),
      usa_oculos: getRadioValue("usa_oculos"),
      ultimo_exame_vista: document.getElementById("ultimo_exame_vista").value,
      palpite_brasil: parseInt(document.getElementById("palpite_brasil").value, 10),
      palpite_marrocos: parseInt(document.getElementById("palpite_marrocos").value, 10),
      consentimento_marketing: document.getElementById("consentimento_marketing").checked,
    };
  }

  async function submitForm(ev) {
    ev.preventDefault();
    hideError();

    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }

    var cfg = getConfig();
    if (!cfg.supabaseUrl || !cfg.anonKey) {
      showError("Configuração do servidor indisponível. Tente novamente mais tarde.");
      return;
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
        palpite: payload.palpite_brasil + "x" + payload.palpite_marrocos,
      });

      form.hidden = true;
      successEl.hidden = false;
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      showError(err.message || "Erro ao enviar. Tente novamente.");
      trackEvent("Lead", { content_name: "Campanha Copa", status: "error" });
    } finally {
      btnSubmit.disabled = false;
      btnSubmit.textContent = "Enviar";
    }
  }

  function clearForm() {
    form.reset();
    hideError();
    trackEvent("CustomizeProduct", { content_name: "Campanha Copa", action: "clear" });
  }

  form.addEventListener("submit", submitForm);
  btnClear.addEventListener("click", clearForm);

  trackEvent("ViewContent", { content_name: "Campanha Copa" });
})();
