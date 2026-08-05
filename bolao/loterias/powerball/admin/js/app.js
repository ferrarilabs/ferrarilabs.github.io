// Powerball Admin — shell + Participantes screen.
// STATUS: validado estaticamente, NÃO EXECUTADO (no reachable Supabase project in this
// sandbox — no Docker/local Supabase available). See
// docs/bolao/loterias/POWERBALL_ADMIN_TEST_PLAN.md for the full status matrix.
//
// Hard rules enforced in this file:
// - Zero localStorage calls (grep-tested by tests/no_localstorage_test.mjs).
// - sessionStorage used only inside supabaseClient.js for the auth session — nowhere here.
// - Every button that exists calls a real RPC (supabase.rpc(...)); there are no
//   simulated/fake actions. Sections not yet wired render as plain text with no buttons,
//   per the explicit instruction: an unwired button must not exist, not exist as a decoy.
// - Every screen re-reads from Supabase on load; no operational data is cached beyond the
//   current render (state is discarded/re-fetched on tab focus regain and on section change).

(function () {
  "use strict";

  const SECTIONS = [
    { id: "overview", label: "Visão geral", implemented: false },
    { id: "participants", label: "Participantes", implemented: true },
    { id: "payments", label: "Pagamentos", implemented: false },
    { id: "draws", label: "Sorteios", implemented: false },
    { id: "tickets", label: "Bilhetes", implemented: false },
    { id: "publications", label: "Publicações", implemented: false },
    { id: "results", label: "Resultados", implemented: false },
    { id: "emails", label: "E-mails", implemented: false },
    { id: "receipts", label: "Comprovantes", implemented: false },
    { id: "audit", label: "Auditoria", implemented: false },
    { id: "health", label: "Saúde do sistema", implemented: false },
  ];

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => {
      if (k === "text") node.textContent = v;
      else node.setAttribute(k, v);
    });
    (children || []).forEach((c) => node.appendChild(c));
    return node;
  }

  async function requireReasonPrompt(actionLabel) {
    const reason = window.prompt(
      `Motivo obrigatório para: ${actionLabel}\n(mínimo 8 caracteres, não pode ser trivial)`
    );
    if (!reason || reason.trim().length < 8) {
      throw new Error("Motivo obrigatório não fornecido — ação cancelada.");
    }
    return reason.trim();
  }

  function newRequestId() {
    return (window.crypto && window.crypto.randomUUID) ? window.crypto.randomUUID() : String(Date.now());
  }

  async function renderParticipants(root) {
    const supabase = window.PowerballAdmin.getSupabaseClient();
    root.innerHTML = "";
    root.appendChild(el("h2", { text: "Participantes" }));

    const status = el("p", { text: "Carregando participantes…" });
    root.appendChild(status);

    const newBtn = el("button", { type: "button", text: "Novo participante" });
    newBtn.addEventListener("click", async () => {
      try {
        const displayName = window.prompt("Nome do participante:");
        if (!displayName) return;
        const email = window.prompt("Email (opcional):") || null;
        const phone = window.prompt("Telefone (opcional):") || null;
        const reason = await requireReasonPrompt("criar participante");
        newBtn.disabled = true;
        // Real RPC call — no direct table write. admin_create_participant is a
        // SECURITY DEFINER function defined in migrations/003_rpcs.sql; it re-checks
        // auth.uid()/role/reason server-side regardless of what this client sends.
        const { data, error } = await supabase.rpc("admin_create_participant", {
          p_display_name: displayName,
          p_email: email,
          p_phone: phone,
          p_reason: reason,
          p_request_id: newRequestId(),
        });
        if (error) throw error;
        await load();
      } catch (e) {
        window.alert("Falha ao criar participante: " + e.message);
      } finally {
        newBtn.disabled = false;
      }
    });
    root.appendChild(newBtn);

    const table = el("table", { class: "pb-admin-table" });
    root.appendChild(table);

    async function load() {
      status.textContent = "Carregando participantes…";
      // Direct SELECT is allowed under RLS (read policies exist for owner/admin/auditor);
      // only writes are RPC-only. This always re-fetches from Supabase — nothing is cached.
      const { data, error } = await supabase
        .from("lottery_participants")
        .select("participant_id, display_name, email, phone, state, version, updated_at")
        .order("updated_at", { ascending: false });
      if (error) {
        status.textContent = "Erro ao carregar: " + error.message;
        return;
      }
      status.textContent = `${data.length} participante(s).`;
      table.innerHTML = "";
      const header = el("tr", {}, [
        el("th", { text: "Nome" }),
        el("th", { text: "Email" }),
        el("th", { text: "Estado" }),
        el("th", { text: "Versão" }),
        el("th", { text: "Ações" }),
      ]);
      table.appendChild(header);
      data.forEach((p) => {
        const archiveBtn = el("button", { type: "button", text: "Arquivar" });
        archiveBtn.disabled = p.state === "archived";
        archiveBtn.addEventListener("click", async () => {
          try {
            const reason = await requireReasonPrompt(`arquivar participante ${p.display_name}`);
            archiveBtn.disabled = true;
            const { error } = await supabase.rpc("admin_archive_participant", {
              p_participant_id: p.participant_id,
              p_expected_version: p.version,
              p_reason: reason,
              p_request_id: newRequestId(),
            });
            if (error) {
              if (String(error.message).startsWith("STALE_VERSION")) {
                window.alert("Este registro foi alterado por outro processo. Recarregue os dados antes de continuar.");
                await load();
                return;
              }
              throw error;
            }
            await load();
          } catch (e) {
            window.alert("Falha ao arquivar: " + e.message);
            archiveBtn.disabled = false;
          }
        });
        const row = el("tr", {}, [
          el("td", { text: p.display_name }),
          el("td", { text: p.email || "—" }),
          el("td", { text: p.state }),
          el("td", { text: String(p.version) }),
          el("td", {}, [archiveBtn]),
        ]);
        table.appendChild(row);
      });
    }

    await load();
  }

  function renderNotImplemented(root, section) {
    root.innerHTML = "";
    root.appendChild(el("h2", { text: section.label }));
    root.appendChild(
      el("p", {
        text:
          "Não implementado nesta fase — sem botões nesta tela para evitar ações " +
          "decorativas não funcionais. Ver docs/bolao/loterias/POWERBALL_ADMIN_ARCHITECTURE.md " +
          "para o desenho de RPCs já especificado para esta área.",
      })
    );
  }

  async function renderShell() {
    const app = document.getElementById("app");
    app.innerHTML = "";

    const nav = el("nav", { class: "pb-admin-nav" });
    const content = el("main", { class: "pb-admin-content" });

    const logoutBtn = el("button", { type: "button", text: "Sair" });
    logoutBtn.addEventListener("click", () => window.PowerballAdmin.auth.signOut());

    SECTIONS.forEach((section) => {
      const btn = el("button", { type: "button", text: section.label });
      btn.addEventListener("click", () => selectSection(section));
      nav.appendChild(btn);
    });
    nav.appendChild(logoutBtn);

    async function selectSection(section) {
      if (section.implemented && section.id === "participants") {
        await renderParticipants(content);
      } else {
        renderNotImplemented(content, section);
      }
    }

    app.appendChild(nav);
    app.appendChild(content);
    await selectSection(SECTIONS[1]); // land on Participantes, the one real screen
  }

  async function boot() {
    const loginView = document.getElementById("login-view");
    const appView = document.getElementById("app-view");
    try {
      const session = await window.PowerballAdmin.auth.getSession();
      if (!session) {
        loginView.style.display = "";
        appView.style.display = "none";
        return;
      }
      loginView.style.display = "none";
      appView.style.display = "";
      await renderShell();
    } catch (e) {
      loginView.style.display = "";
      appView.style.display = "none";
      const errBox = document.getElementById("login-error");
      if (errBox) errBox.textContent = "Erro de sessão/configuração: " + e.message;
    }
  }

  // Revalidate on tab focus regain, per the "no client cache beyond render" rule — reloads
  // session + re-renders the current section from scratch rather than trusting stale state.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") boot();
  });

  document.addEventListener("DOMContentLoaded", () => {
    const form = document.getElementById("login-form");
    if (form) {
      form.addEventListener("submit", async (evt) => {
        evt.preventDefault();
        const email = document.getElementById("login-email").value;
        const password = document.getElementById("login-password").value;
        const errBox = document.getElementById("login-error");
        errBox.textContent = "";
        try {
          await window.PowerballAdmin.auth.signIn(email, password);
          await boot();
        } catch (e) {
          errBox.textContent = "Falha no login: " + e.message;
        }
      });
    }
    boot();
  });
})();
