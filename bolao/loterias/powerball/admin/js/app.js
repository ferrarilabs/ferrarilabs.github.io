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
    { id: "overview", label: "Visão geral", implemented: true },
    { id: "participants", label: "Participantes", implemented: true },
    { id: "payments", label: "Pagamentos", implemented: true },
    { id: "draws", label: "Sorteios", implemented: true },
    { id: "tickets", label: "Bilhetes", implemented: true },
    { id: "publications", label: "Publicações", implemented: true },
    { id: "results", label: "Resultados", implemented: true },
    { id: "emails", label: "E-mails", implemented: true },
    { id: "receipts", label: "Comprovantes", implemented: false },
    { id: "audit", label: "Auditoria", implemented: true },
    { id: "health", label: "Saúde do sistema", implemented: true },
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

  async function renderPayments(root) {
    const supabase = window.PowerballAdmin.getSupabaseClient();
    root.innerHTML = "";
    root.appendChild(el("h2", { text: "Pagamentos" }));
    root.appendChild(
      el("p", {
        text:
          "Ledger append-only: correções nunca editam uma transação existente, apenas criam " +
          "uma reversão referenciando a original.",
      })
    );

    const status = el("p", { text: "Carregando pagamentos…" });
    root.appendChild(status);

    const newBtn = el("button", { type: "button", text: "Registrar pagamento" });
    newBtn.addEventListener("click", async () => {
      try {
        const participationId = window.prompt("participation_id (UUID de lottery_participations):");
        if (!participationId) return;
        const type = window.prompt("Tipo (contribution/refund/adjustment/carryover):", "contribution");
        if (!type) return;
        const amountStr = window.prompt("Valor (USD):");
        const amount = Number(amountStr);
        if (!amountStr || Number.isNaN(amount)) {
          window.alert("Valor inválido — ação cancelada.");
          return;
        }
        const externalReference = window.prompt("Referência externa (Zelle/PIX/txId, opcional):") || null;
        const reason = await requireReasonPrompt("registrar pagamento");
        newBtn.disabled = true;
        const { error } = await supabase.rpc("admin_record_payment", {
          p_participation_id: participationId,
          p_type: type,
          p_amount: amount,
          p_external_reference: externalReference,
          p_proof_object_path: null,
          p_reason: reason,
          p_request_id: newRequestId(),
        });
        if (error) throw error;
        await load();
      } catch (e) {
        window.alert("Falha ao registrar pagamento: " + e.message);
      } finally {
        newBtn.disabled = false;
      }
    });
    root.appendChild(newBtn);

    const table = el("table", { class: "pb-admin-table" });
    root.appendChild(table);

    async function load() {
      status.textContent = "Carregando pagamentos…";
      const { data, error } = await supabase
        .from("lottery_payment_transactions")
        .select("transaction_id, participation_id, type, amount, external_reference, reverses_transaction_id, created_at")
        .order("created_at", { ascending: false });
      if (error) {
        status.textContent = "Erro ao carregar: " + error.message;
        return;
      }
      status.textContent = `${data.length} transação(ões).`;
      table.innerHTML = "";
      table.appendChild(
        el("tr", {}, [
          el("th", { text: "Data" }),
          el("th", { text: "Tipo" }),
          el("th", { text: "Valor" }),
          el("th", { text: "Referência" }),
          el("th", { text: "Ações" }),
        ])
      );
      data.forEach((t) => {
        const reverseBtn = el("button", { type: "button", text: "Reverter" });
        reverseBtn.disabled = t.type === "reversal" || Boolean(t.reverses_transaction_id);
        reverseBtn.addEventListener("click", async () => {
          try {
            const reason = await requireReasonPrompt(`reverter transação ${t.transaction_id}`);
            reverseBtn.disabled = true;
            const { error } = await supabase.rpc("admin_reverse_payment", {
              p_transaction_id: t.transaction_id,
              p_reason: reason,
              p_request_id: newRequestId(),
            });
            if (error) throw error;
            await load();
          } catch (e) {
            window.alert("Falha ao reverter: " + e.message);
            reverseBtn.disabled = false;
          }
        });
        table.appendChild(
          el("tr", {}, [
            el("td", { text: new Date(t.created_at).toLocaleString("pt-BR") }),
            el("td", { text: t.type }),
            el("td", { text: Number(t.amount).toFixed(2) }),
            el("td", { text: t.external_reference || "—" }),
            el("td", {}, [reverseBtn]),
          ])
        );
      });
    }

    await load();
  }

  async function renderDraws(root) {
    const supabase = window.PowerballAdmin.getSupabaseClient();
    root.innerHTML = "";
    root.appendChild(el("h2", { text: "Sorteios" }));

    const status = el("p", { text: "Carregando sorteios…" });
    root.appendChild(status);

    const newBtn = el("button", { type: "button", text: "Novo sorteio" });
    newBtn.addEventListener("click", async () => {
      try {
        const poolId = window.prompt("pool_id (UUID de lottery_pools):");
        if (!poolId) return;
        const drawDate = window.prompt("Data do sorteio (YYYY-MM-DD):");
        if (!drawDate) return;
        const jackpot = Number(window.prompt("Estimativa de jackpot (USD, opcional):") || "0") || null;
        const cashValue = Number(window.prompt("Estimativa de cash value (USD, opcional):") || "0") || null;
        const reason = await requireReasonPrompt("criar sorteio");
        newBtn.disabled = true;
        const { error } = await supabase.rpc("admin_create_draw", {
          p_pool_id: poolId,
          p_draw_date: drawDate,
          p_jackpot_estimate: jackpot,
          p_cash_value_estimate: cashValue,
          p_reason: reason,
          p_request_id: newRequestId(),
        });
        if (error) throw error;
        await load();
      } catch (e) {
        window.alert("Falha ao criar sorteio: " + e.message);
      } finally {
        newBtn.disabled = false;
      }
    });
    root.appendChild(newBtn);

    const table = el("table", { class: "pb-admin-table" });
    root.appendChild(table);

    async function load() {
      status.textContent = "Carregando sorteios…";
      const { data, error } = await supabase
        .from("lottery_draws")
        .select("draw_id, draw_date, jackpot_estimate, cash_value_estimate, status, version")
        .order("draw_date", { ascending: false });
      if (error) {
        status.textContent = "Erro ao carregar: " + error.message;
        return;
      }
      status.textContent = `${data.length} sorteio(s).`;
      table.innerHTML = "";
      table.appendChild(
        el("tr", {}, [
          el("th", { text: "Data" }),
          el("th", { text: "Jackpot est." }),
          el("th", { text: "Cash value est." }),
          el("th", { text: "Status" }),
          el("th", { text: "Ações" }),
        ])
      );
      data.forEach((d) => {
        const editBtn = el("button", { type: "button", text: "Editar estimativas" });
        editBtn.addEventListener("click", async () => {
          try {
            const jackpot = Number(window.prompt("Novo jackpot estimado (USD):", d.jackpot_estimate ?? "") || "");
            const cashValue = Number(window.prompt("Novo cash value estimado (USD):", d.cash_value_estimate ?? "") || "");
            if (Number.isNaN(jackpot) || Number.isNaN(cashValue)) {
              window.alert("Valores inválidos — ação cancelada.");
              return;
            }
            const reason = await requireReasonPrompt(`editar estimativas do sorteio ${d.draw_date}`);
            editBtn.disabled = true;
            const { error } = await supabase.rpc("admin_update_draw_estimates", {
              p_draw_id: d.draw_id,
              p_jackpot_estimate: jackpot,
              p_cash_value_estimate: cashValue,
              p_expected_version: d.version,
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
            window.alert("Falha ao editar: " + e.message);
          } finally {
            editBtn.disabled = false;
          }
        });
        table.appendChild(
          el("tr", {}, [
            el("td", { text: d.draw_date }),
            el("td", { text: d.jackpot_estimate != null ? Number(d.jackpot_estimate).toFixed(2) : "—" }),
            el("td", { text: d.cash_value_estimate != null ? Number(d.cash_value_estimate).toFixed(2) : "—" }),
            el("td", { text: d.status }),
            el("td", {}, [editBtn]),
          ])
        );
      });
    }

    await load();
  }

  async function renderTickets(root) {
    const supabase = window.PowerballAdmin.getSupabaseClient();
    root.innerHTML = "";
    root.appendChild(el("h2", { text: "Bilhetes" }));
    root.appendChild(
      el("p", {
        text:
          "Rascunhos (draft) podem ser editados livremente. Uma vez publicados (ver seção " +
          "Publicações — ainda não implementada nesta fase), tornam-se imutáveis; correções " +
          "criam uma nova versão de publicação, nunca editam o bilhete publicado.",
      })
    );

    const status = el("p", { text: "Carregando bilhetes…" });
    root.appendChild(status);

    function parseNumbers(input) {
      const parts = (input || "").split(/[\s,]+/).filter(Boolean).map(Number);
      if (parts.length !== 5 || parts.some((n) => Number.isNaN(n))) return null;
      return parts;
    }

    const newBtn = el("button", { type: "button", text: "Novo bilhete (rascunho)" });
    newBtn.addEventListener("click", async () => {
      try {
        const drawId = window.prompt("draw_id (UUID de lottery_draws):");
        if (!drawId) return;
        const numbers = parseNumbers(window.prompt("5 números principais, separados por espaço (ex: 04 12 13 43 49):"));
        if (!numbers) {
          window.alert("Números inválidos — informe exatamente 5 números. Ação cancelada.");
          return;
        }
        const powerball = Number(window.prompt("Número do Powerball (1-26):"));
        if (!powerball || powerball < 1 || powerball > 26) {
          window.alert("Powerball inválido — ação cancelada.");
          return;
        }
        const powerPlay = window.confirm("Power Play ativado? OK = sim, Cancelar = não");
        const reason = await requireReasonPrompt("criar bilhete");
        newBtn.disabled = true;
        const { error } = await supabase.rpc("admin_create_ticket", {
          p_draw_id: drawId,
          p_numbers: numbers,
          p_powerball: powerball,
          p_power_play: powerPlay,
          p_reason: reason,
          p_request_id: newRequestId(),
        });
        if (error) throw error;
        await load();
      } catch (e) {
        window.alert("Falha ao criar bilhete: " + e.message);
      } finally {
        newBtn.disabled = false;
      }
    });
    root.appendChild(newBtn);

    const table = el("table", { class: "pb-admin-table" });
    root.appendChild(table);

    async function load() {
      status.textContent = "Carregando bilhetes…";
      const { data, error } = await supabase
        .from("lottery_tickets")
        .select("ticket_id, draw_id, numbers, powerball, power_play, status, version, updated_at")
        .order("updated_at", { ascending: false });
      if (error) {
        status.textContent = "Erro ao carregar: " + error.message;
        return;
      }
      status.textContent = `${data.length} bilhete(s).`;
      table.innerHTML = "";
      table.appendChild(
        el("tr", {}, [
          el("th", { text: "Números" }),
          el("th", { text: "Powerball" }),
          el("th", { text: "Power Play" }),
          el("th", { text: "Status" }),
          el("th", { text: "Ações" }),
        ])
      );
      data.forEach((t) => {
        const editBtn = el("button", { type: "button", text: "Editar rascunho" });
        editBtn.disabled = t.status !== "draft";
        editBtn.addEventListener("click", async () => {
          try {
            const numbers = parseNumbers(
              window.prompt("Novos 5 números principais, separados por espaço:", (t.numbers || []).join(" "))
            );
            if (!numbers) {
              window.alert("Números inválidos — ação cancelada.");
              return;
            }
            const powerball = Number(window.prompt("Novo número do Powerball (1-26):", t.powerball));
            if (!powerball || powerball < 1 || powerball > 26) {
              window.alert("Powerball inválido — ação cancelada.");
              return;
            }
            const powerPlay = window.confirm("Power Play ativado? OK = sim, Cancelar = não");
            const reason = await requireReasonPrompt(`editar bilhete ${t.ticket_id}`);
            editBtn.disabled = true;
            const { error } = await supabase.rpc("admin_update_draft_ticket", {
              p_ticket_id: t.ticket_id,
              p_numbers: numbers,
              p_powerball: powerball,
              p_power_play: powerPlay,
              p_expected_version: t.version,
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
            window.alert("Falha ao editar: " + e.message);
          } finally {
            editBtn.disabled = false;
          }
        });
        table.appendChild(
          el("tr", {}, [
            el("td", { text: (t.numbers || []).join("-") }),
            el("td", { text: String(t.powerball) }),
            el("td", { text: t.power_play ? "Sim" : "Não" }),
            el("td", { text: t.status }),
            el("td", {}, [editBtn]),
          ])
        );
      });
    }

    await load();
  }

  async function renderResults(root) {
    const supabase = window.PowerballAdmin.getSupabaseClient();
    root.innerHTML = "";
    root.appendChild(el("h2", { text: "Resultados" }));
    root.appendChild(
      el("p", {
        text:
          "Correção de resultado é uma ação crítica: exige digitar CONFIRMAR literalmente, " +
          "cria uma nova linha (supersede) e nunca edita o resultado original.",
      })
    );

    const status = el("p", { text: "Carregando resultados…" });
    root.appendChild(status);

    function parseNumbers(input) {
      const parts = (input || "").split(/[\s,]+/).filter(Boolean).map(Number);
      if (parts.length !== 5 || parts.some((n) => Number.isNaN(n))) return null;
      return parts;
    }

    const newBtn = el("button", { type: "button", text: "Registrar resultado" });
    newBtn.addEventListener("click", async () => {
      try {
        const drawId = window.prompt("draw_id (UUID de lottery_draws):");
        if (!drawId) return;
        const numbers = parseNumbers(window.prompt("5 números sorteados, separados por espaço:"));
        if (!numbers) {
          window.alert("Números inválidos — ação cancelada.");
          return;
        }
        const powerball = Number(window.prompt("Powerball sorteado (1-26):"));
        if (!powerball || powerball < 1 || powerball > 26) {
          window.alert("Powerball inválido — ação cancelada.");
          return;
        }
        const jackpot = Number(window.prompt("Jackpot pago (USD, opcional):") || "0") || null;
        const reason = await requireReasonPrompt("registrar resultado");
        newBtn.disabled = true;
        const { error } = await supabase.rpc("admin_record_result", {
          p_draw_id: drawId,
          p_numbers: numbers,
          p_powerball: powerball,
          p_jackpot_amount: jackpot,
          p_reason: reason,
          p_request_id: newRequestId(),
        });
        if (error) throw error;
        await load();
      } catch (e) {
        window.alert("Falha ao registrar resultado: " + e.message);
      } finally {
        newBtn.disabled = false;
      }
    });
    root.appendChild(newBtn);

    const table = el("table", { class: "pb-admin-table" });
    root.appendChild(table);

    async function load() {
      status.textContent = "Carregando resultados…";
      const { data, error } = await supabase
        .from("lottery_results")
        .select("result_id, draw_id, numbers, powerball, jackpot_amount, status, created_at")
        .order("created_at", { ascending: false });
      if (error) {
        status.textContent = "Erro ao carregar: " + error.message;
        return;
      }
      status.textContent = `${data.length} resultado(s).`;
      table.innerHTML = "";
      table.appendChild(
        el("tr", {}, [
          el("th", { text: "Números" }),
          el("th", { text: "Powerball" }),
          el("th", { text: "Jackpot" }),
          el("th", { text: "Status" }),
          el("th", { text: "Ações" }),
        ])
      );
      data.forEach((r) => {
        const correctBtn = el("button", { type: "button", text: "Corrigir (crítico)" });
        correctBtn.disabled = r.status !== "active";
        correctBtn.addEventListener("click", async () => {
          try {
            const numbers = parseNumbers(
              window.prompt("Números corrigidos, separados por espaço:", (r.numbers || []).join(" "))
            );
            if (!numbers) {
              window.alert("Números inválidos — ação cancelada.");
              return;
            }
            const powerball = Number(window.prompt("Powerball corrigido (1-26):", r.powerball));
            if (!powerball || powerball < 1 || powerball > 26) {
              window.alert("Powerball inválido — ação cancelada.");
              return;
            }
            const jackpot = Number(window.prompt("Jackpot corrigido (USD, opcional):", r.jackpot_amount ?? "") || "0") || null;
            const reason = await requireReasonPrompt(`corrigir resultado ${r.result_id}`);
            const confirmation = window.prompt(
              'Ação crítica: esta correção afeta o resultado publicado deste sorteio. ' +
              'Digite CONFIRMAR (exatamente, em maiúsculas) para prosseguir:'
            );
            if (confirmation !== "CONFIRMAR") {
              window.alert('Confirmação não corresponde a "CONFIRMAR" — ação cancelada.');
              return;
            }
            correctBtn.disabled = true;
            const { error } = await supabase.rpc("admin_correct_result", {
              p_result_id: r.result_id,
              p_numbers: numbers,
              p_powerball: powerball,
              p_jackpot_amount: jackpot,
              p_reason: reason,
              p_confirmation_text: confirmation,
              p_request_id: newRequestId(),
            });
            if (error) throw error;
            await load();
          } catch (e) {
            window.alert("Falha ao corrigir: " + e.message);
          } finally {
            correctBtn.disabled = false;
          }
        });
        table.appendChild(
          el("tr", {}, [
            el("td", { text: (r.numbers || []).join("-") }),
            el("td", { text: String(r.powerball) }),
            el("td", { text: r.jackpot_amount != null ? Number(r.jackpot_amount).toFixed(2) : "—" }),
            el("td", { text: r.status }),
            el("td", {}, [correctBtn]),
          ])
        );
      });
    }

    await load();
  }

  async function renderPublications(root) {
    const supabase = window.PowerballAdmin.getSupabaseClient();
    root.innerHTML = "";
    root.appendChild(el("h2", { text: "Publicações" }));
    root.appendChild(
      el("p", {
        text:
          "Publicar bilhetes é uma ação crítica e irreversível (os bilhetes referenciados " +
          "tornam-se imutáveis). Exige digitar CONFIRMAR. NOTA: o financial_snapshot/" +
          "participant_snapshot enviados aqui são um resumo mínimo (contagem de bilhetes + " +
          "timestamp), não o cálculo financeiro completo por participante -- essa lógica de " +
          "negócio não foi implementada nesta fase e está documentada como pendência em " +
          "POWERBALL_ADMIN_ARCHITECTURE.md, não escondida.",
      })
    );

    const status = el("p", { text: "Carregando publicações…" });
    root.appendChild(status);

    const newBtn = el("button", { type: "button", text: "Publicar bilhetes (crítico)" });
    newBtn.addEventListener("click", async () => {
      try {
        const drawId = window.prompt("draw_id (UUID de lottery_draws):");
        if (!drawId) return;
        const ticketIdsRaw = window.prompt("ticket_id(s) a publicar, separados por vírgula:");
        if (!ticketIdsRaw) return;
        const ticketIds = ticketIdsRaw.split(",").map((s) => s.trim()).filter(Boolean);
        if (ticketIds.length === 0) {
          window.alert("Nenhum ticket_id informado — ação cancelada.");
          return;
        }
        const reason = await requireReasonPrompt("publicar bilhetes");
        const impactMsg =
          `Impacto: ${ticketIds.length} bilhete(s) do sorteio ${drawId} serão marcados como ` +
          `publicados e se tornarão imutáveis. Esta ação não pode ser desfeita (apenas ` +
          `corrigida por uma nova versão de publicação).\n\nDigite CONFIRMAR para prosseguir:`;
        const confirmation = window.prompt(impactMsg);
        if (confirmation !== "CONFIRMAR") {
          window.alert('Confirmação não corresponde a "CONFIRMAR" — ação cancelada.');
          return;
        }
        newBtn.disabled = true;
        const manifest = { ticket_ids: ticketIds, draw_id: drawId, published_at_client: new Date().toISOString() };
        const financialSnapshot = { ticket_count: ticketIds.length, note: "resumo mínimo — não é o cálculo financeiro completo" };
        const participantSnapshot = { note: "resumo mínimo — snapshot completo por participante não implementado nesta fase" };
        const { error } = await supabase.rpc("admin_publish_tickets", {
          p_draw_id: drawId,
          p_ticket_ids: ticketIds,
          p_manifest: manifest,
          p_financial_snapshot: financialSnapshot,
          p_participant_snapshot: participantSnapshot,
          p_reason: reason,
          p_confirmation_text: confirmation,
          p_request_id: newRequestId(),
        });
        if (error) throw error;
        await load();
      } catch (e) {
        window.alert("Falha ao publicar: " + e.message);
      } finally {
        newBtn.disabled = false;
      }
    });
    root.appendChild(newBtn);

    const table = el("table", { class: "pb-admin-table" });
    root.appendChild(table);

    async function load() {
      status.textContent = "Carregando publicações…";
      const { data, error } = await supabase
        .from("lottery_ticket_publications")
        .select("publication_id, draw_id, version, status, manifest_hash, published_at, created_at")
        .order("created_at", { ascending: false });
      if (error) {
        status.textContent = "Erro ao carregar: " + error.message;
        return;
      }
      status.textContent = `${data.length} publicação(ões).`;
      table.innerHTML = "";
      table.appendChild(
        el("tr", {}, [
          el("th", { text: "Sorteio" }),
          el("th", { text: "Versão" }),
          el("th", { text: "Status" }),
          el("th", { text: "Hash do manifesto" }),
          el("th", { text: "Publicado em" }),
        ])
      );
      data.forEach((p) => {
        table.appendChild(
          el("tr", {}, [
            el("td", { text: p.draw_id }),
            el("td", { text: String(p.version) }),
            el("td", { text: p.status }),
            el("td", { text: (p.manifest_hash || "").slice(0, 12) + "…" }),
            el("td", { text: p.published_at ? new Date(p.published_at).toLocaleString("pt-BR") : "—" }),
          ])
        );
      });
    }

    await load();
  }

  async function renderEmails(root) {
    const supabase = window.PowerballAdmin.getSupabaseClient();
    root.innerHTML = "";
    root.appendChild(el("h2", { text: "E-mails" }));
    root.appendChild(
      el("p", {
        text:
          "Esta tela apenas gerencia a fila persistida (lottery_email_jobs). O envio real é " +
          "feito pelo worker de e-mail já existente (reaproveitado de " +
          "powerball-email-professionalization) -- nenhum envio acontece diretamente do " +
          "navegador.",
      })
    );

    const status = el("p", { text: "Carregando fila de e-mails…" });
    root.appendChild(status);

    const newBtn = el("button", { type: "button", text: "Enfileirar e-mail" });
    newBtn.addEventListener("click", async () => {
      try {
        const jobType = window.prompt("Tipo (participant_added/tickets_published/tickets_corrected/admin_test):", "admin_test");
        if (!jobType) return;
        const entityType = window.prompt("entity_type (ex: participant, ticket_publication; opcional):") || null;
        const entityId = window.prompt("entity_id (UUID, opcional):") || null;
        const recipientEmail = window.prompt("Email do destinatário:");
        if (!recipientEmail) return;
        const reason = await requireReasonPrompt("enfileirar e-mail");
        newBtn.disabled = true;
        const { error } = await supabase.rpc("admin_enqueue_email", {
          p_job_type: jobType,
          p_entity_type: entityType,
          p_entity_id: entityId,
          p_recipient_email: recipientEmail,
          p_reason: reason,
          p_request_id: newRequestId(),
        });
        if (error) throw error;
        await load();
      } catch (e) {
        window.alert("Falha ao enfileirar: " + e.message);
      } finally {
        newBtn.disabled = false;
      }
    });
    root.appendChild(newBtn);

    const table = el("table", { class: "pb-admin-table" });
    root.appendChild(table);

    async function load() {
      status.textContent = "Carregando fila de e-mails…";
      const { data, error } = await supabase
        .from("lottery_email_jobs")
        .select("job_id, job_type, recipient_email, status, attempts, last_error, created_at")
        .order("created_at", { ascending: false });
      if (error) {
        status.textContent = "Erro ao carregar: " + error.message;
        return;
      }
      status.textContent = `${data.length} job(s).`;
      table.innerHTML = "";
      table.appendChild(
        el("tr", {}, [
          el("th", { text: "Tipo" }),
          el("th", { text: "Destinatário" }),
          el("th", { text: "Status" }),
          el("th", { text: "Tentativas" }),
          el("th", { text: "Ações" }),
        ])
      );
      data.forEach((j) => {
        const retryBtn = el("button", { type: "button", text: "Tentar novamente" });
        retryBtn.disabled = !(j.status === "failed" || j.status === "cancelled");
        retryBtn.addEventListener("click", async () => {
          try {
            const reason = await requireReasonPrompt(`reenviar job ${j.job_id}`);
            retryBtn.disabled = true;
            const { error } = await supabase.rpc("admin_retry_email", {
              p_job_id: j.job_id, p_reason: reason, p_request_id: newRequestId(),
            });
            if (error) throw error;
            await load();
          } catch (e) {
            window.alert("Falha ao reenviar: " + e.message);
            retryBtn.disabled = false;
          }
        });
        const cancelBtn = el("button", { type: "button", text: "Cancelar" });
        cancelBtn.disabled = !(j.status === "pending" || j.status === "processing");
        cancelBtn.addEventListener("click", async () => {
          try {
            const reason = await requireReasonPrompt(`cancelar job ${j.job_id}`);
            cancelBtn.disabled = true;
            const { error } = await supabase.rpc("admin_cancel_email_job", {
              p_job_id: j.job_id, p_reason: reason, p_request_id: newRequestId(),
            });
            if (error) throw error;
            await load();
          } catch (e) {
            window.alert("Falha ao cancelar: " + e.message);
            cancelBtn.disabled = false;
          }
        });
        table.appendChild(
          el("tr", {}, [
            el("td", { text: j.job_type }),
            el("td", { text: j.recipient_email }),
            el("td", { text: j.status + (j.last_error ? ` (${j.last_error})` : "") }),
            el("td", { text: String(j.attempts) }),
            el("td", {}, [retryBtn, cancelBtn]),
          ])
        );
      });
    }

    await load();
  }

  async function renderOverview(root) {
    const supabase = window.PowerballAdmin.getSupabaseClient();
    root.innerHTML = "";
    root.appendChild(el("h2", { text: "Visão geral" }));
    const status = el("p", { text: "Carregando…" });
    root.appendChild(status);
    const grid = el("ul");
    root.appendChild(grid);

    async function load() {
      status.textContent = "Carregando…";
      // Read-only aggregate counts, all real RLS-gated SELECTs, re-fetched every time this
      // screen is opened (no client-side cache of these numbers).
      const [draws, participants, participations, tickets, publications, pendingEmails, failedEmails] = await Promise.all([
        supabase.from("lottery_draws").select("draw_id, draw_date, jackpot_estimate, cash_value_estimate, status").order("draw_date", { ascending: false }).limit(1),
        supabase.from("lottery_participants").select("participant_id", { count: "exact", head: true }).eq("state", "active"),
        supabase.from("lottery_participations").select("cotas").eq("state", "active"),
        supabase.from("lottery_tickets").select("ticket_id", { count: "exact", head: true }),
        supabase.from("lottery_ticket_publications").select("publication_id, status", { count: "exact" }).eq("status", "published"),
        supabase.from("lottery_email_jobs").select("job_id", { count: "exact", head: true }).eq("status", "pending"),
        supabase.from("lottery_email_jobs").select("job_id", { count: "exact", head: true }).eq("status", "failed"),
      ]);
      const firstError = [draws, participants, participations, tickets, publications, pendingEmails, failedEmails].find((r) => r.error);
      if (firstError) {
        status.textContent = "Erro ao carregar visão geral: " + firstError.error.message;
        return;
      }
      const nextDraw = draws.data && draws.data[0];
      const totalCotas = (participations.data || []).reduce((sum, p) => sum + Number(p.cotas || 0), 0);
      status.textContent = "";
      grid.innerHTML = "";
      const items = [
        `Próximo/último sorteio: ${nextDraw ? nextDraw.draw_date : "—"} (status: ${nextDraw ? nextDraw.status : "—"})`,
        `Jackpot estimado: ${nextDraw && nextDraw.jackpot_estimate != null ? Number(nextDraw.jackpot_estimate).toFixed(2) : "—"}`,
        `Cash value estimado: ${nextDraw && nextDraw.cash_value_estimate != null ? Number(nextDraw.cash_value_estimate).toFixed(2) : "—"}`,
        `Participantes ativos: ${participants.count ?? 0}`,
        `Total de cotas ativas: ${totalCotas}`,
        `Bilhetes (total): ${tickets.count ?? 0}`,
        `Publicações publicadas: ${publications.count ?? 0}`,
        `E-mails pendentes: ${pendingEmails.count ?? 0}`,
        `E-mails com falha: ${failedEmails.count ?? 0}`,
        `Última atualização: ${new Date().toLocaleString("pt-BR")}`,
      ];
      items.forEach((text) => grid.appendChild(el("li", { text })));
    }

    await load();
  }

  async function renderAudit(root) {
    const supabase = window.PowerballAdmin.getSupabaseClient();
    root.innerHTML = "";
    root.appendChild(el("h2", { text: "Auditoria" }));
    root.appendChild(
      el("p", {
        text:
          "Log append-only. UPDATE/DELETE são bloqueados por trigger no banco mesmo para " +
          "owner. Esta tela é somente leitura + verificação de integridade da cadeia de hash.",
      })
    );

    const status = el("p", { text: "Carregando…" });
    root.appendChild(status);

    const verifyBtn = el("button", { type: "button", text: "Verificar cadeia de auditoria" });
    const verifyResult = el("p", { id: "audit-verify-result" });
    verifyBtn.addEventListener("click", async () => {
      try {
        verifyBtn.disabled = true;
        verifyResult.textContent = "Verificando…";
        // Real RPC call — verify_powerball_audit_chain() walks the whole table and
        // recomputes the hash chain server-side; nothing is computed client-side.
        const { data, error } = await supabase.rpc("verify_powerball_audit_chain");
        if (error) throw error;
        const row = data && data[0];
        verifyResult.textContent = row.valid
          ? `Cadeia válida (${row.checked_count} entrada(s) verificada(s)).`
          : `CADEIA INVÁLIDA — primeira entrada corrompida: ${row.first_broken_audit_id}`;
      } catch (e) {
        verifyResult.textContent = "Falha ao verificar: " + e.message;
      } finally {
        verifyBtn.disabled = false;
      }
    });
    root.appendChild(verifyBtn);
    root.appendChild(verifyResult);

    const table = el("table", { class: "pb-admin-table" });
    root.appendChild(table);

    async function load() {
      status.textContent = "Carregando…";
      const { data, error } = await supabase
        .from("lottery_admin_audit")
        .select("audit_id, actor_email_snapshot, action_type, entity_type, reason, server_created_at")
        .order("server_created_at", { ascending: false })
        .limit(50);
      if (error) {
        status.textContent = "Erro ao carregar: " + error.message;
        return;
      }
      status.textContent = `Últimas ${data.length} entrada(s) (máx. 50).`;
      table.innerHTML = "";
      table.appendChild(
        el("tr", {}, [
          el("th", { text: "Data (servidor)" }),
          el("th", { text: "Ator" }),
          el("th", { text: "Ação" }),
          el("th", { text: "Entidade" }),
          el("th", { text: "Motivo" }),
        ])
      );
      data.forEach((a) => {
        table.appendChild(
          el("tr", {}, [
            el("td", { text: new Date(a.server_created_at).toLocaleString("pt-BR") }),
            el("td", { text: a.actor_email_snapshot || "—" }),
            el("td", { text: a.action_type }),
            el("td", { text: a.entity_type }),
            el("td", { text: a.reason || "—" }),
          ])
        );
      });
    }

    await load();
  }

  async function renderHealth(root) {
    const supabase = window.PowerballAdmin.getSupabaseClient();
    root.innerHTML = "";
    root.appendChild(el("h2", { text: "Saúde do sistema" }));
    const status = el("p", { text: "Verificando…" });
    root.appendChild(status);
    const list = el("ul");
    root.appendChild(list);

    async function load() {
      status.textContent = "Verificando…";
      const startedAt = Date.now();
      const [session, pendingJobs, failedJobs, chain] = await Promise.all([
        window.PowerballAdmin.auth.getSession(),
        supabase.from("lottery_email_jobs").select("job_id", { count: "exact", head: true }).eq("status", "pending"),
        supabase.from("lottery_email_jobs").select("job_id", { count: "exact", head: true }).eq("status", "failed"),
        supabase.rpc("verify_powerball_audit_chain"),
      ]);
      const latencyMs = Date.now() - startedAt;
      status.textContent = "";
      list.innerHTML = "";
      const items = [
        `Conexão Supabase: ${pendingJobs.error && failedJobs.error ? "FALHA" : "OK"} (round-trip ~${latencyMs}ms)`,
        `Sessão válida: ${session ? "sim" : "não"}`,
        `Versão do frontend (cache-bust): ver index.html (?v=...) — não lido automaticamente aqui`,
        `Jobs de e-mail pendentes: ${pendingJobs.count ?? "erro"}`,
        `Jobs de e-mail com falha: ${failedJobs.count ?? "erro"}`,
        `Cadeia de auditoria válida: ${chain.error ? "erro: " + chain.error.message : (chain.data && chain.data[0] && chain.data[0].valid ? "sim" : "NÃO — investigar")}`,
      ];
      items.forEach((text) => list.appendChild(el("li", { text })));
      list.appendChild(
        el("li", {
          text:
            "Reconciliação financeira, comprovantes ausentes e jobs travados (processing há " +
            "muito tempo) não são checados aqui ainda — dependem de dados/lógica não " +
            "implementados nesta fase (ver POWERBALL_ADMIN_ARCHITECTURE.md).",
        })
      );
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
      if (section.id === "overview") {
        await renderOverview(content);
      } else if (section.id === "audit") {
        await renderAudit(content);
      } else if (section.id === "health") {
        await renderHealth(content);
      } else if (section.id === "participants") {
        await renderParticipants(content);
      } else if (section.id === "payments") {
        await renderPayments(content);
      } else if (section.id === "draws") {
        await renderDraws(content);
      } else if (section.id === "tickets") {
        await renderTickets(content);
      } else if (section.id === "results") {
        await renderResults(content);
      } else if (section.id === "publications") {
        await renderPublications(content);
      } else if (section.id === "emails") {
        await renderEmails(content);
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
