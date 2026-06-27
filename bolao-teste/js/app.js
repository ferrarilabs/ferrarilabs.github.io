(() => {
"use strict";

const CONFIG = window.BOLAO_CONFIG;
const DATA = window.BOLAO_DATA;
const I18N = window.BOLAO_I18N;
const $ = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));
let currentLang = localStorage.getItem("bolao_lang") || "pt-BR";
let polymarketCache = { ts: 0, markets: [] };

function t(k){ return I18N?.[currentLang]?.[k] || I18N?.["pt-BR"]?.[k] || k; }
function escapeHtml(v){ return String(v ?? "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;"); }
function state(){ try { return Object.assign({entries:[], paid:{}, results:{}}, JSON.parse(localStorage.getItem(CONFIG.storeKey) || "{}")); } catch { return {entries:[], paid:{}, results:{}}; } }
function saveState(s){ localStorage.setItem(CONFIG.storeKey, JSON.stringify(s)); }
function phaseLabel(p){ return ({"Round of 32":t("phaseR32"),"Round of 16":t("phaseR16"),"Quarterfinal":t("phaseQF"),"Semifinal":t("phaseSF"),"3rd Place":t("phaseThird"),"Final":t("phaseFinal")})[p] || p; }
function flag(name){ const n=String(name||"").toLowerCase(); const map={"south africa":"🇿🇦","canada":"🇨🇦","brazil":"🇧🇷","brasil":"🇧🇷","japan":"🇯🇵","argentina":"🇦🇷","france":"🇫🇷","germany":"🇩🇪","spain":"🇪🇸","portugal":"🇵🇹","england":"🏴󠁧󠁢󠁥󠁮󠁧󠁿","italy":"🇮🇹","netherlands":"🇳🇱","holanda":"🇳🇱","mexico":"🇲🇽","usa":"🇺🇸","united states":"🇺🇸","united states of america":"🇺🇸","uruguay":"🇺🇾","colombia":"🇨🇴","senegal":"🇸🇳","iraq":"🇮🇶","norway":"🇳🇴","morocco":"🇲🇦","ivory coast":"🇨🇮","c\u00f4te d\u2019ivoire":"🇨🇮","cote d'ivoire":"🇨🇮","australia":"🇦🇺","saudi arabia":"🇸🇦","qatar":"🇶🇦","ghana":"🇬🇭","nigeria":"🇳🇬","egypt":"🇪🇬","tunisia":"🇹🇳","algeria":"🇩🇿","croatia":"🇭🇷","switzerland":"🇨🇭","belgium":"🇧🇪","denmark":"🇩🇰","sweden":"🇸🇪","poland":"🇵🇱","austria":"🇦🇹","serbia":"🇷🇸","ukraine":"🇺🇦","turkey":"🇹🇷","t\u00fcrkiye":"🇹🇷","south korea":"🇰🇷","korea republic":"🇰🇷","iran":"🇮🇷","uzbekistan":"🇺🇿","jordan":"🇯🇴","new zealand":"🇳🇿","panama":"🇵🇦","costa rica":"🇨🇷","jamaica":"🇯🇲","haiti":"🇭🇹","curacao":"🇨🇼","cura\u00e7ao":"🇨🇼","paraguay":"🇵🇾","ecuador":"🇪🇨","chile":"🇨🇱","peru":"🇵🇪","venezuela":"🇻🇪","bolivia":"🇧🇴","bosnia and herzegovina":"🇧🇦","scotland":"🏴󠁧󠁢󠁳󠁣󠁴󠁿","wales":"🏴󠁧󠁢󠁷󠁬󠁳󠁿","czechia":"🇨🇿","czech republic":"🇨🇿","slovakia":"🇸🇰","hungary":"🇭🇺","romania":"🇷🇴","greece":"🇬🇷","albania":"🇦🇱","georgia":"🇬🇪","slovenia":"🇸🇮","cape verde":"🇨🇻","cabo verde":"🇨🇻"}; return map[n] || "🏳️"; }
function cutoffDate(){ return new Date(CONFIG.cutoffIso); }
function isPastCutoff(){ return Date.now() >= cutoffDate().getTime(); }
function formatDate(d){ if(!d) return ""; const p=String(d).split("-"); if(p.length===3) return new Date(+p[0],+p[1]-1,+p[2]).toLocaleDateString(currentLang,{weekday:"short",month:"short",day:"numeric",year:"numeric"}); return d; }
function matchMeta(m){ const parts=[]; if(m.date) parts.push(`<span class="pill">📅 <b>${t("matchDateLabel")}:</b> ${escapeHtml(formatDate(m.date))}</span>`); if(m.timeET) parts.push(`<span class="pill">🕒 <b>${t("matchTimeLabel")}:</b> ${escapeHtml(m.timeET)}</span>`); parts.push(`<span class="pill">📍 <b>${t("matchVenueLabel")}:</b> ${escapeHtml(m.venue||t("venueTbd"))}</span>`); return parts.join(""); }
function isSlot(v){ return /^Winner |^Loser /.test(String(v||"")); }
function slotMatch(v){ const m=String(v||"").match(/Match\s+(\d+)/i); return m ? m[1] : ""; }
function resolveSlotName(v,winners={},losers={}){ const s=String(v||""); if(/^Winner/i.test(s)) return winners[slotMatch(s)] || s; if(/^Loser/i.test(s)) return losers[slotMatch(s)] || s; return s; }
function winnerLabel(m){ return /final|3rd/i.test(m.phase||"") ? t("winnerLabelFinal") : t("winnerLabelAdv"); }

function isValidEmail(email){ const e=String(email||"").trim(); return !!e && !/\s/.test(e) && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e); }
function parseScoreValue(v){ const s=String(v??"").trim(); if(!/^\d+$/.test(s)) return null; const n=Number(s); return Number.isInteger(n)&&n>=0&&n<=20 ? n : null; }
function pickWinnerSide(a,b){ return a>b ? "A" : b>a ? "B" : ""; }
function validateScorePair(a,b){ return Number.isInteger(a)&&Number.isInteger(b)&&a>=0&&b>=0&&a<=20&&b<=20; }
function scoreWarningLevel(a,b){ const max=Math.max(a,b), diff=Math.abs(a-b), total=a+b; if(max>=10||diff>=8||total>=12) return "extreme"; if(max>=6||diff>=5||total>=9) return "unusual"; return "normal"; }
function confirmUnusualScores(picks){ const rep={}; let crazy=false; Object.values(picks).forEach(p=>{ const k=`${p.goalsA}x${p.goalsB}`; rep[k]=(rep[k]||0)+1; if(scoreWarningLevel(p.goalsA,p.goalsB)!=="normal") crazy=true; }); if(crazy && !confirm(`${t("crazyScoreWarning")}\n\n${t("keepScore")}?`)) return false; if(Object.values(rep).some(n=>n>=8) && !confirm(`${t("repetitiveWarning")}\n\n${t("keepScore")}?`)) return false; return true; }

async function sha256Hex(text){ const data=new TextEncoder().encode(text); const hash=await crypto.subtle.digest("SHA-256",data); return Array.from(new Uint8Array(hash)).map(b=>b.toString(16).padStart(2,"0")).join(""); }
function hashString(str){ let h=2166136261; for(let i=0;i<str.length;i++){ h^=str.charCodeAt(i); h=Math.imul(h,16777619); } return (h>>>0).toString(16).padStart(8,"0").toUpperCase(); }
function receiptCode(e){ return `BOLAO-${hashString(JSON.stringify({n:e.entryName,p:e.picks,t:e.createdAt}))}-${String(e.createdAt||"").slice(0,10).replaceAll("-","")}`; }

function applyLanguage(){
  document.documentElement.lang=currentLang;
  document.title=`${CONFIG.appName} - Copa 2026`;
  $$("[data-i18n]").forEach(el=>{ el.textContent=t(el.dataset.i18n); });
  $("#languageSelect").value=currentLang;
}
function showSection(id){ $$(".page").forEach(p=>p.classList.toggle("active",p.id===id)); $$(".nav button").forEach(b=>b.classList.toggle("active",b.dataset.section===id)); renderAll(); }
function updateCountdown(){ const diff=cutoffDate()-new Date(); const box=$("#countdown"); if(!box) return; if(diff<=0){ box.innerHTML=`<strong>${t("closed")}</strong>`; return; } const mins=Math.floor(diff/60000), d=Math.floor(mins/1440), h=Math.floor((mins%1440)/60), m=mins%60; box.innerHTML=`<div class="count-grid"><div><b>${d}</b><span>dias</span></div><div><b>${h}</b><span>hrs</span></div><div><b>${m}</b><span>min</span></div></div>`; $("#cutoffLabel").textContent=CONFIG.cutoffLabel; }
function lockIfCutoff(){ const closed=isPastCutoff(); $("#saveEntry").disabled=closed; if(closed) $$("#bracketForm input,#bracketForm select,#smartPick,#randomPick").forEach(el=>el.disabled=true); }

function setupPaymentBox(){ const method=$("#paymentMethod").value; const box=$("#paymentBox"); if(!method){ box.innerHTML=""; return;} const to=CONFIG.paymentMethods[method]||""; const link=CONFIG.paymentLinks[method]||""; box.innerHTML=`<div class="pay-card"><img src="assets/${method.toLowerCase()==="cashapp"?"cashapp":method.toLowerCase()}.svg" alt="${method}"><div><b>${escapeHtml(method)}</b><br><span class="muted">${escapeHtml(to)}</span>${link?`<br><a href="${escapeHtml(link)}" target="_blank" rel="noopener">Abrir pagamento</a>`:""}</div></div>`; }

function inferFromForm(){ const winners={}, losers={}; DATA.knockoutMatches.forEach(m=>{ const card=$(`[data-card-match="${m.match}"]`); const a=resolveSlotName(m.teamA,winners,losers), b=resolveSlotName(m.teamB,winners,losers); if(card){ card.dataset.currentA=a; card.dataset.currentB=b; const ga=parseScoreValue(card.querySelector('[data-field="goalsA"]')?.value); const gb=parseScoreValue(card.querySelector('[data-field="goalsB"]')?.value); const sel=card.querySelector('[data-field="advanceSide"]'); let side=""; if(ga!==null&&gb!==null) side=pickWinnerSide(ga,gb)||sel?.value||""; if(side==="A"){winners[m.match]=a; losers[m.match]=b;} if(side==="B"){winners[m.match]=b; losers[m.match]=a;} } }); return {winners,losers}; }
function updateCard(card){ const m=DATA.knockoutMatches.find(x=>String(x.match)===String(card.dataset.cardMatch)); if(!m) return; const {winners,losers}=inferFromForm(); const a=resolveSlotName(m.teamA,winners,losers), b=resolveSlotName(m.teamB,winners,losers); card.dataset.currentA=a; card.dataset.currentB=b; card.querySelector(".team-a").innerHTML=`${flag(a)} ${escapeHtml(a)}`; card.querySelector(".team-b").innerHTML=`${escapeHtml(b)} ${flag(b)}`; const ga=parseScoreValue(card.querySelector('[data-field="goalsA"]').value); const gb=parseScoreValue(card.querySelector('[data-field="goalsB"]').value); const sel=card.querySelector('[data-field="advanceSide"]'); if(sel){ const optA=sel.querySelector('option[value="A"]'); const optB=sel.querySelector('option[value="B"]'); if(optA) optA.textContent=a; if(optB) optB.textContent=b; } if(ga!==null&&gb!==null){ const side=pickWinnerSide(ga,gb); if(side){ sel.value=side; sel.disabled=true; card.querySelector(".auto-note").textContent=t("autoAdvanceNote").replace("{team}", side==="A"?a:b); } else { sel.disabled=false; card.querySelector(".auto-note").textContent=t("tieNote"); } } }
function updateDynamic(){ $$(".match-card[data-card-match]").forEach(updateCard); updateProgress(); }
function updateProgress(){ const total=DATA.knockoutMatches.length; let done=0; DATA.knockoutMatches.forEach(m=>{ const c=$(`[data-card-match="${m.match}"]`); if(!c) return; const ga=c.querySelector('[data-field="goalsA"]').value, gb=c.querySelector('[data-field="goalsB"]').value; if(ga!==""&&gb!=="") done++; }); $("#progressText").textContent=`${done}/${total}`; $("#progressBar").style.width=`${total?done/total*100:0}%`; }

function renderBracket(){ const form=$("#bracketForm"); form.innerHTML=""; DATA.knockoutMatches.forEach(m=>{ const card=document.createElement("div"); card.className="match-card"; card.dataset.cardMatch=m.match; card.innerHTML=`<div class="match-head"><span class="match-badge">Match ${m.match}</span><span class="phase">${phaseLabel(m.phase)}</span></div><div class="match-meta">${matchMeta(m)}</div><div class="teams"><div class="team team-a"></div><div class="vs">x</div><div class="team team-b right"></div></div><div class="score-inputs"><label>A<input type="number" min="0" max="20" step="1" inputmode="numeric" enterkeyhint="next" data-field="goalsA"></label><label>B<input type="number" min="0" max="20" step="1" inputmode="numeric" enterkeyhint="next" data-field="goalsB"></label></div><label>${winnerLabel(m)}<select data-field="advanceSide"><option value="">${t("selectOption")}</option><option value="A">${escapeHtml(m.teamA)}</option><option value="B">${escapeHtml(m.teamB)}</option></select></label><div class="auto-note"></div>`; form.appendChild(card); }); updateDynamic(); }

async function collectDiagnostics(){ const tz=Intl.DateTimeFormat().resolvedOptions().timeZone; return {userAgent:navigator.userAgent, platform:navigator.platform, language:navigator.language, timezone:tz, viewport:`${innerWidth}x${innerHeight}`, capturedAt:new Date().toISOString()}; }
async function readEntryFromForm(){ updateDynamic(); const entryName=$("#entryName").value.trim(), payerName=$("#payerName").value.trim(), participantEmail=$("#participantEmail").value.trim(), paymentMethod=$("#paymentMethod").value; if(!entryName){alert(t("requiredEntryName")); return null;} if(!payerName){alert(t("requiredPayerName")); return null;} if(!paymentMethod){alert(t("requiredPaymentMethod")); return null;} if(!isValidEmail(participantEmail)){alert(t("invalidEmail")); $("#participantEmail").focus(); return null;} const picks={}; for(const m of DATA.knockoutMatches){ const c=$(`[data-card-match="${m.match}"]`); const gaRaw=c.querySelector('[data-field="goalsA"]').value, gbRaw=c.querySelector('[data-field="goalsB"]').value; if(gaRaw===""||gbRaw===""){alert(`${t("missingScore")} Match ${m.match}`); return null;} const goalsA=parseScoreValue(gaRaw), goalsB=parseScoreValue(gbRaw); if(goalsA===null||goalsB===null){alert(`${t("invalidScore")} Match ${m.match}`); return null;} const winner=pickWinnerSide(goalsA,goalsB); const side=winner || c.querySelector('[data-field="advanceSide"]').value; if(winner && side!==winner){alert(`${t("inconsistentAdvance")} Match ${m.match}`); return null;} if(!winner && !side){alert(`${t("tieNeedsAdvance")} Match ${m.match}`); return null;} picks[m.match]={goalsA,goalsB,advanceSide:side,displayA:c.dataset.currentA,displayB:c.dataset.currentB}; } if(!confirmUnusualScores(picks)) return null; const diagnostics=CONFIG.diagnostics.captureDeviceInfo ? await collectDiagnostics() : {}; return {id:crypto.randomUUID?crypto.randomUUID():String(Date.now())+Math.random(),entryName,payerName,participantEmail,paymentMethod,paymentTo:CONFIG.paymentMethods[paymentMethod],createdAt:new Date().toISOString(),diagnostics,picks}; }

function resolvedTeamsForEntry(entry){ const resolved={}, winners={}, losers={}; DATA.knockoutMatches.forEach(m=>{ const p=entry.picks[m.match]; const a=resolveSlotName(m.teamA,winners,losers), b=resolveSlotName(m.teamB,winners,losers); resolved[m.match]={displayA:a,displayB:b}; if(p){ if(p.advanceSide==="A"){winners[m.match]=a; losers[m.match]=b;} else {winners[m.match]=b; losers[m.match]=a;} } }); return resolved; }
function finalPodiumForEntry(entry){ const r=resolvedTeamsForEntry(entry); const final=DATA.knockoutMatches.find(m=>/final/i.test(m.phase)||String(m.match)==="104"); const third=DATA.knockoutMatches.find(m=>/3rd|third/i.test(m.phase)||String(m.match)==="103"); let champion="Não definido",runnerUp="Não definido",thirdPlace="Não definido",fourth="Não definido"; if(final&&entry.picks[final.match]){ const p=entry.picks[final.match], rr=r[final.match]; champion=p.advanceSide==="A"?rr.displayA:rr.displayB; runnerUp=p.advanceSide==="A"?rr.displayB:rr.displayA; } if(third&&entry.picks[third.match]){ const p=entry.picks[third.match], rr=r[third.match]; thirdPlace=p.advanceSide==="A"?rr.displayA:rr.displayB; fourth=p.advanceSide==="A"?rr.displayB:rr.displayA; } return {champion,runnerUp,third:thirdPlace,fourth}; }
function receiptHtml(entry){ const r=resolvedTeamsForEntry(entry); const pod=finalPodiumForEntry(entry); const rows=DATA.knockoutMatches.map(m=>{ const p=entry.picks[m.match], rr=r[m.match]; const win=p.advanceSide==="A"?rr.displayA:rr.displayB; return `<tr><td>Match ${m.match}<br><small>${escapeHtml(phaseLabel(m.phase))}</small></td><td>${escapeHtml(rr.displayA)}</td><td><b>${p.goalsA} x ${p.goalsB}</b></td><td>${escapeHtml(rr.displayB)}</td><td>${escapeHtml(win)}</td></tr>`; }).join(""); return `<!doctype html><html><head><meta charset="utf-8"><title>Comprovante ${escapeHtml(entry.entryName)}</title><style>body{font-family:Arial,sans-serif;background:#f4f7fb;margin:0;color:#111}.doc{max-width:960px;margin:24px auto;background:white;border-radius:18px;padding:28px;box-shadow:0 12px 40px #0002}h1{margin:0}.meta{display:grid;grid-template-columns:1fr 1fr;gap:12px;background:#f1f5f9;border-radius:14px;padding:14px;margin:18px 0}.code{font-family:monospace;color:#087a35;font-weight:bold}.pod{background:linear-gradient(135deg,#07151c,#0f3b22);color:#fff;border-radius:18px;padding:18px;margin:22px 0}.pod h2{text-align:center}.podgrid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.podcard{border-radius:14px;padding:16px;text-align:center;background:#ffffff18}.champ{grid-column:1/3;background:#ffd35a;color:#111}.team{font-size:24px;font-weight:900}table{width:100%;border-collapse:collapse}td,th{padding:9px;border-bottom:1px solid #dde}th{background:#07151c;color:white;text-align:left}.notice{background:#fff4cc;border:1px solid #e8c65b;border-radius:12px;padding:12px;margin-top:18px}@media print{body{background:white}.doc{box-shadow:none;margin:0}}</style></head><body><div class="doc"><h1>${t("receiptTitle")}</h1><p>${t("receiptIntro")}</p><div class="meta"><div><b>${t("receiptEntry")}:</b> ${escapeHtml(entry.entryName)}<br><b>${t("receiptResponsible")}:</b> ${escapeHtml(entry.payerName)}<br><b>${t("receiptEmail")}:</b> ${escapeHtml(entry.participantEmail)}</div><div><b>${t("receiptPayment")}:</b> ${escapeHtml(entry.paymentMethod)} — ${escapeHtml(entry.paymentTo)}<br><b>${t("receiptSentAt")}:</b> ${new Date(entry.createdAt).toLocaleString("pt-BR")}<br><b>${t("receiptCode")}:</b> <span class="code">${receiptCode(entry)}</span></div></div><div class="pod"><h2>${t("receiptFinalPick")}</h2><div class="podgrid"><div class="podcard champ"><div>${t("receiptChampion")}</div><div class="team">${escapeHtml(pod.champion)}</div></div><div class="podcard"><div>${t("receiptRunnerUp")}</div><div class="team">${escapeHtml(pod.runnerUp)}</div></div><div class="podcard"><div>${t("receiptThird")}</div><div class="team">${escapeHtml(pod.third)}</div></div><div class="podcard"><div>${t("receiptFourth")}</div><div class="team">${escapeHtml(pod.fourth)}</div></div></div></div><table><thead><tr><th>${t("receiptGame")}</th><th>${t("receiptTeamA")}</th><th>${t("receiptScore")}</th><th>${t("receiptTeamB")}</th><th>${t("receiptWinner")}</th></tr></thead><tbody>${rows}</tbody></table><div class="notice"><b>${t("receiptRuleLabel")}:</b> ${t("receiptRuleText")}</div></div></body></html>`; }
function receiptText(entry){ return `Comprovante ${receiptCode(entry)}\nEntrada: ${entry.entryName}\nResponsável: ${entry.payerName}`; }
function openReceipt(id){ const e=state().entries.find(x=>x.id===id); if(!e) return; const blob=new Blob([receiptHtml(e)],{type:"text/html;charset=utf-8"}); const url=URL.createObjectURL(blob); const w=open(url,"_blank","noopener"); if(!w){ URL.revokeObjectURL(url); alert(t("receiptPopupBlocked")); return;} setTimeout(()=>URL.revokeObjectURL(url),60000); }
function downloadReceipt(id){ const e=state().entries.find(x=>x.id===id); if(!e) return; downloadText(`comprovante-${receiptCode(e)}.html`, receiptHtml(e), "text/html"); }
function renderLatestReceipt(e){ const box=$("#latestReceiptBox"); box.classList.remove("hidden"); box.innerHTML=`<h2>${t("savedTitle")}</h2><p>${t("savedText")}</p><div class="receipt-code">${receiptCode(e)}</div><div class="receipt-actions"><button type="button" onclick="window.Bolao.openReceipt('${e.id}')">${t("openReceipt")}</button><button type="button" class="secondary" onclick="window.Bolao.downloadReceipt('${e.id}')">${t("downloadHtml")}</button><button type="button" class="secondary" onclick="window.Bolao.mailReceipt('${e.id}','participant')">${t("sendEmail")}</button></div>`; box.scrollIntoView({behavior:"smooth",block:"center"}); }

function setupEmailJs(){ if(!window.emailjs||!CONFIG.emailjs.enabled) return; try{ emailjs.init({publicKey:CONFIG.emailjs.publicKey, limitRate:{throttle:CONFIG.emailjs.limitRateMs||30000}, blockHeadless:true}); }catch(e){ console.warn(e); } }
async function mailReceipt(id,target="participant"){ const e=state().entries.find(x=>x.id===id); if(!e) return; const to=target==="admin"?CONFIG.adminEmail:e.participantEmail; if(!to) return alert(t("invalidEmail")); if(!window.emailjs) return alert(t("emailjsNotLoaded")); const template=target==="admin"?CONFIG.emailjs.adminTemplateId:CONFIG.emailjs.participantTemplateId; await emailjs.send(CONFIG.emailjs.serviceId,template,{to_email:to,entry_name:e.entryName,receipt_code:receiptCode(e),html_message:receiptHtml(e)},{publicKey:CONFIG.emailjs.publicKey}); alert(t("emailSent")); }
async function sendRemovalEmail(e,reason){ if(!e.participantEmail||!window.emailjs) return; const html=`<div style="font-family:Arial"><h2>Entrada removida do Bolão Copa 2026</h2><p><b>${t("receiptEntry")}:</b> ${escapeHtml(e.entryName)}</p><p><b>${t("receiptCode")}:</b> ${receiptCode(e)}</p><p><b>Motivo:</b> ${escapeHtml(reason||"Correção administrativa.")}</p></div>`; await emailjs.send(CONFIG.emailjs.serviceId,CONFIG.emailjs.participantTemplateId,{to_email:e.participantEmail,entry_name:`REMOVIDA - ${e.entryName}`,receipt_code:receiptCode(e),html_message:html},{publicKey:CONFIG.emailjs.publicKey}); }

function actualResults(){ return state().results||{}; }

function podiumFromResults(s){
  const winners={}, losers={};
  for(const m of DATA.knockoutMatches){
    const r=(s.results||{})[m.match];
    const a=resolveSlotName(m.teamA,winners,losers);
    const b=resolveSlotName(m.teamB,winners,losers);
    if(!r || r.goalsA==="" || r.goalsB==="" || r.goalsA===undefined || r.goalsB===undefined) continue;
    const side=r.advanceSide || pickWinnerSide(Number(r.goalsA), Number(r.goalsB));
    if(!side) continue;
    if(side==="A"){ winners[m.match]=a; losers[m.match]=b; }
    else { winners[m.match]=b; losers[m.match]=a; }
  }
  const final=DATA.knockoutMatches.find(m=>/final/i.test(m.phase)||String(m.match)==="104");
  const third=DATA.knockoutMatches.find(m=>/3rd|third/i.test(m.phase)||String(m.match)==="103");
  let champion="", runnerUp="", thirdPlace="", fourth="";
  if(final){
    const r=(s.results||{})[final.match];
    const a=resolveSlotName(final.teamA,winners,losers);
    const b=resolveSlotName(final.teamB,winners,losers);
    const side=r ? (r.advanceSide || pickWinnerSide(Number(r.goalsA), Number(r.goalsB))) : "";
    if(side==="A"){ champion=a; runnerUp=b; }
    if(side==="B"){ champion=b; runnerUp=a; }
  }
  if(third){
    const r=(s.results||{})[third.match];
    const a=resolveSlotName(third.teamA,winners,losers);
    const b=resolveSlotName(third.teamB,winners,losers);
    const side=r ? (r.advanceSide || pickWinnerSide(Number(r.goalsA), Number(r.goalsB))) : "";
    if(side==="A"){ thirdPlace=a; fourth=b; }
    if(side==="B"){ thirdPlace=b; fourth=a; }
  }
  if(!champion || !runnerUp || !thirdPlace || !fourth) return null;
  return {champion, runnerUp, third:thirdPlace, fourth};
}

function scoreEntry(entry,s){
  let total=0, details=[];
  const results=s.results||{};
  DATA.knockoutMatches.forEach(m=>{
    const p=entry.picks[m.match], r=results[m.match];
    if(!p||!r||r.goalsA===""||r.goalsB===""||r.goalsA===undefined||r.goalsB===undefined) return;
    const pA=Number(p.goalsA), pB=Number(p.goalsB), rA=Number(r.goalsA), rB=Number(r.goalsB);
    let pts=0;
    if(pA===rA && pB===rB) pts+=CONFIG.scoring.exactScore;
    else {
      if(pA===rA) pts+=CONFIG.scoring.oneTeamGoals;
      if(pB===rB) pts+=CONFIG.scoring.oneTeamGoals;
    }
    const realSide=r.advanceSide || pickWinnerSide(rA,rB);
    if(p.advanceSide===realSide) pts+=CONFIG.scoring.advance;
    total+=pts;
    details.push({match:m.match,pts});
  });
  const realPod=podiumFromResults(s);
  const pickPod=finalPodiumForEntry(entry);
  const bonus={champion:0, runnerUp:0, third:0, fourth:0, total:0};
  if(realPod){
    if(pickPod.champion===realPod.champion) bonus.champion=CONFIG.bonus.champion||0;
    if(pickPod.runnerUp===realPod.runnerUp) bonus.runnerUp=CONFIG.bonus.runnerUp||0;
    if(pickPod.third===realPod.third) bonus.third=CONFIG.bonus.third||0;
    if(pickPod.fourth===realPod.fourth) bonus.fourth=CONFIG.bonus.fourth||0;
    bonus.total=bonus.champion+bonus.runnerUp+bonus.third+bonus.fourth;
    total+=bonus.total;
  }
  return {total,details,bonus};
}
function renderRanking(){ const s=state(), box=$("#rankingList"); const rows=s.entries.map(e=>{const sc=scoreEntry(e,s); return {...e,score:sc.total,bonus:sc.bonus};}).sort((a,b)=>b.score-a.score); if(!rows.length){box.innerHTML=`<div class="card"><p>${t("noEntries")}</p></div>`;return;} box.innerHTML=""; rows.forEach((e,i)=>{ const div=document.createElement("div"); div.className="rank-row"; div.innerHTML=`<div>${i===0?"🥇":i===1?"🥈":i===2?"🥉":i+1}</div><div><b>${escapeHtml(e.entryName)}</b><br><span class="muted">${escapeHtml(e.payerName)}${e.bonus&&e.bonus.total?` • ${t("bonusLabel")} +${e.bonus.total}`:""}</span><br><span class="receipt-code">${receiptCode(e)}</span></div><div class="points">${e.score}</div><button type="button" class="secondary small-btn" data-rank-toggle="${e.id}">${t("viewPicks")}</button>`; box.appendChild(div); const detail=document.createElement("div"); detail.className="card picks-detail hidden"; detail.dataset.rankDetail=e.id; detail.innerHTML=picksTable(e); box.appendChild(detail); }); }
function picksTable(e){ const r=resolvedTeamsForEntry(e); const rows=DATA.knockoutMatches.map(m=>{ const p=e.picks[m.match], rr=r[m.match], w=p.advanceSide==="A"?rr.displayA:rr.displayB; return `<tr><td>Match ${m.match}</td><td>${escapeHtml(rr.displayA)}</td><td><b>${p.goalsA} x ${p.goalsB}</b></td><td>${escapeHtml(rr.displayB)}</td><td>${escapeHtml(w)}</td></tr>`; }).join(""); return `<table><thead><tr><th>Jogo</th><th>A</th><th>Placar</th><th>B</th><th>Ganha</th></tr></thead><tbody>${rows}</tbody></table>`; }
function renderParticipants(){ const s=state(), box=$("#participantsList"); if(!s.entries.length){box.innerHTML=`<div class="card">${t("noEntries")}</div>`;return;} box.innerHTML=""; s.entries.forEach(e=>{ const div=document.createElement("div"); div.className="rank-row"; div.innerHTML=`<div>👤</div><div><b>${escapeHtml(e.entryName)}</b><br><span class="muted">${escapeHtml(e.payerName)} • ${escapeHtml(e.paymentMethod)}</span></div><div>${s.paid[e.id]?t("paymentPaid"):t("paymentPending")}</div>`; box.appendChild(div); }); }
function renderPayments(){ const box=$("#paymentMethods"); box.innerHTML=""; Object.entries(CONFIG.paymentMethods).forEach(([m,v])=>{ const img=m==="CashApp"?"cashapp":m.toLowerCase(); const div=document.createElement("div"); div.className="card pay-card"; div.innerHTML=`<img src="assets/${img}.svg" alt="${m}"><div><b>${m}</b><br><span class="muted">${escapeHtml(v)}</span></div>`; box.appendChild(div); }); }
function renderGames(){ const box=$("#gamesList"); const rows=[...(DATA.groupMatches||[]),...(DATA.knockoutMatches||[])]; box.innerHTML=""; rows.forEach(m=>{ const div=document.createElement("div"); div.className="match-card"; div.innerHTML=`<div class="match-head"><span>${escapeHtml(m.match)}</span><span>${escapeHtml(m.status||m.phase||"")}</span></div><div class="match-meta">${matchMeta(m)}</div><div class="teams"><div>${flag(m.teamA)} ${escapeHtml(m.teamA)}</div><div>x</div><div class="right">${escapeHtml(m.teamB)} ${flag(m.teamB)}</div></div>${m.goalsA!==undefined?`<p><b>${m.goalsA} x ${m.goalsB}</b></p>`:""}`; box.appendChild(div); }); }
function renderAdmin(){ const s=state(); renderAdminReceipts(s); renderAdminPayments(s); renderAdminResults(s); }
function renderAdminReceipts(s){ const box=$("#adminReceipts"); box.innerHTML=`<h2>${t("adminReceipts")}</h2>`; if(!s.entries.length){box.innerHTML+=`<p>${t("noEntries")}</p>`; return;} s.entries.forEach(e=>{ const div=document.createElement("div"); div.className="admin-entry item"; div.innerHTML=`<b>${escapeHtml(e.entryName)}</b><br><span class="muted">${escapeHtml(e.payerName)} • ${escapeHtml(e.participantEmail)}</span><br><span class="receipt-code">${receiptCode(e)}</span><div class="receipt-actions"><button type="button" class="small-btn" data-act="open" data-id="${e.id}">${t("openReceipt")}</button><button type="button" class="small-btn secondary" data-act="html" data-id="${e.id}">${t("downloadHtml")}</button><button type="button" class="small-btn secondary" data-act="emailp" data-id="${e.id}">${t("participantEmailBtn")}</button><button type="button" class="small-btn secondary" data-act="emaila" data-id="${e.id}">${t("adminEmailBtn")}</button><button type="button" class="small-btn danger" data-act="delete" data-id="${e.id}">${t("deleteEntry")}</button></div>`; box.appendChild(div); }); }
function renderAdminPayments(s){ const box=$("#paymentsAdmin"); box.innerHTML=`<h2>${t("adminPayments")}</h2>`; s.entries.forEach(e=>{ const div=document.createElement("div"); div.className="rank-row"; div.innerHTML=`<div>💵</div><div><b>${escapeHtml(e.entryName)}</b><br>${escapeHtml(e.paymentMethod)} → ${escapeHtml(e.paymentTo)}</div><label><input type="checkbox" data-paid="${e.id}" ${s.paid[e.id]?"checked":""}> ${t("paymentPaid")}</label>`; box.appendChild(div); }); }
function inferReal(){ const s=state(), winners={}, losers={}; DATA.knockoutMatches.forEach(m=>{ const r=s.results[m.match]; const a=resolveSlotName(m.teamA,winners,losers), b=resolveSlotName(m.teamB,winners,losers); if(r&&r.advanceSide){ if(r.advanceSide==="A"){winners[m.match]=a;losers[m.match]=b;} else {winners[m.match]=b;losers[m.match]=a;} } }); return {winners,losers}; }
function renderAdminResults(s){ const box=$("#resultsAdmin"); const {winners,losers}=inferReal(); box.innerHTML=`<h2>${t("adminResults")}</h2>`; DATA.knockoutMatches.forEach(m=>{ const r=s.results[m.match]||{}, a=resolveSlotName(m.teamA,winners,losers), b=resolveSlotName(m.teamB,winners,losers); const div=document.createElement("div"); div.className="match-card"; div.dataset.realMatch=m.match; div.innerHTML=`<div class="match-head"><span>Match ${m.match}</span><span>${phaseLabel(m.phase)}</span></div><div class="teams"><div>${flag(a)} ${escapeHtml(a)}</div><div>x</div><div>${escapeHtml(b)} ${flag(b)}</div></div><div class="score-inputs"><input type="number" min="0" max="20" inputmode="numeric" data-real-field="goalsA" value="${r.goalsA??""}"><input type="number" min="0" max="20" inputmode="numeric" data-real-field="goalsB" value="${r.goalsB??""}"></div><label>${winnerLabel(m)}<select data-real-field="advanceSide"><option value="">${t("selectOption")}</option><option value="A" ${r.advanceSide==="A"?"selected":""}>${escapeHtml(a)}</option><option value="B" ${r.advanceSide==="B"?"selected":""}>${escapeHtml(b)}</option></select></label>`; box.appendChild(div); updateRealCard(div); }); }

function commitRealCard(card, allowTieWithoutSelection=false){
  const match=card.dataset.realMatch;
  const ga=parseScoreValue(card.querySelector('[data-real-field="goalsA"]').value);
  const gb=parseScoreValue(card.querySelector('[data-real-field="goalsB"]').value);
  const sel=card.querySelector('[data-real-field="advanceSide"]');
  if(ga===null || gb===null) return false;
  const win=pickWinnerSide(ga,gb);
  const side=win || sel.value;
  if(!win && !side && !allowTieWithoutSelection) return false;
  const s=state();
  s.results[match]={goalsA:ga,goalsB:gb,advanceSide:side};
  saveState(s);
  return true;
}

function updateRealCard(card){ const ga=parseScoreValue(card.querySelector('[data-real-field="goalsA"]').value), gb=parseScoreValue(card.querySelector('[data-real-field="goalsB"]').value), sel=card.querySelector('[data-real-field="advanceSide"]'); if(ga===null||gb===null) return; const side=pickWinnerSide(ga,gb); if(side){sel.value=side;sel.disabled=true;} else sel.disabled=false; }

function downloadText(name,content,type="text/plain"){ const blob=new Blob([content],{type:type+";charset=utf-8"}); const url=URL.createObjectURL(blob); const a=document.createElement("a"); a.href=url; a.download=name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),1000); }
function csvEscape(v){ const s=String(v??""); return `"${s.replaceAll('"','""')}"`; }
function objectsToCsv(rows){ if(!rows.length) return ""; const headers=[...rows.reduce((set,r)=>{Object.keys(r).forEach(k=>set.add(k)); return set;},new Set())]; return [headers.map(csvEscape).join(","),...rows.map(r=>headers.map(h=>csvEscape(r[h])).join(","))].join("\n"); }
function exportRows(full=false){ const s=state(); return s.entries.map(e=>{ const row={id:e.id,receiptCode:receiptCode(e),entryName:e.entryName,payerName:e.payerName,email:e.participantEmail,paymentMethod:e.paymentMethod,paid:!!s.paid[e.id],createdAt:e.createdAt,score:scoreEntry(e,s).total}; if(full) DATA.knockoutMatches.forEach(m=>{ const p=e.picks[m.match]; row[`match_${m.match}`]=p?`${p.displayA} ${p.goalsA}x${p.goalsB} ${p.displayB} adv:${p.advanceSide}`:""; }); return row; }); }
function backupJson(){ downloadText(`bolao-backup-${new Date().toISOString().slice(0,10)}.json`, JSON.stringify({exportedAt:new Date().toISOString(),state:state(),data:DATA},null,2), "application/json"); }
function backupCsv(){ downloadText(`bolao-backup-${new Date().toISOString().slice(0,10)}.csv`, objectsToCsv(exportRows(true)), "text/csv"); }
function masterCsv(){ downloadText(`bolao-master-${new Date().toISOString().slice(0,10)}.csv`, objectsToCsv(exportRows(false)), "text/csv"); }
function masterHtml(){ const rows=exportRows(false).map(r=>`<tr><td>${escapeHtml(r.entryName)}</td><td>${escapeHtml(r.payerName)}</td><td>${r.score}</td><td>${escapeHtml(r.receiptCode)}</td></tr>`).join(""); const html=`<!doctype html><meta charset="utf-8"><title>Master List</title><table border="1" cellpadding="6"><tr><th>Entrada</th><th>Responsável</th><th>Pontos</th><th>Código</th></tr>${rows}</table>`; downloadText("master-list.html",html,"text/html"); }

function teamStrength(n){ const s=String(n).toLowerCase(); const map={brazil:92,brasil:92,argentina:91,france:93,spain:88,germany:87,england:88,portugal:87,netherlands:84,japan:76,canada:72,mexico:74,usa:75,senegal:76}; return map[s]||60; }
function predictedScore(a,b,mode){ if(mode==="random") return [Math.floor(Math.random()*4),Math.floor(Math.random()*4)]; const diff=teamStrength(a)-teamStrength(b); const aWin=Math.random()<1/(1+Math.exp(-diff/10)); const close=Math.abs(diff)<8; if(aWin) return close?[2,1]:[3,1]; return close?[1,2]:[1,3]; }
async function autoFill(mode){ if(isPastCutoff()){alert(t("closed"));return;} const filled=$$('[data-field="goalsA"],[data-field="goalsB"]').some(el=>el.value!==""); if(filled&&!confirm(t("overwritePicks"))) return; DATA.knockoutMatches.forEach(m=>{ updateDynamic(); const c=$(`[data-card-match="${m.match}"]`); const a=c.dataset.currentA,b=c.dataset.currentB; let [ga,gb]=predictedScore(a,b,mode); c.querySelector('[data-field="goalsA"]').value=ga; c.querySelector('[data-field="goalsB"]').value=gb; updateCard(c); }); updateDynamic(); }

async function saveEntry(){ const btn=$("#saveEntry"), old=btn.textContent; if(isPastCutoff()){alert(t("cutoffClosed")); return;} btn.disabled=true; btn.textContent=t("saveInProgress"); try{ const entry=await readEntryFromForm(); if(!entry) return; const s=state(); s.entries.push(entry); saveState(s); renderLatestReceipt(entry); renderAll(); await mailReceipt(entry.id,"participant").catch(err=>console.warn("Participant email failed",err)); await mailReceipt(entry.id,"admin").catch(err=>console.warn("Admin email failed",err)); } finally {btn.disabled=false; btn.textContent=old;} }

async function adminLogin(){ const lock=Number(localStorage.getItem("adminLockUntil")||"0"); if(Date.now()<lock) return alert(t("adminLocked")); const hash=await sha256Hex($("#adminPassword").value); if(hash===CONFIG.adminPasswordHash){ sessionStorage.setItem("adminOk","true"); sessionStorage.setItem("adminUntil",String(Date.now()+CONFIG.adminSessionMinutes*60000)); $("#adminLogin").classList.add("hidden"); $("#adminArea").classList.remove("hidden"); renderAll(); } else { const n=Number(localStorage.getItem("adminAttempts")||"0")+1; localStorage.setItem("adminAttempts",String(n)); if(n>=CONFIG.adminMaxAttempts){localStorage.setItem("adminLockUntil",String(Date.now()+CONFIG.adminLockMinutes*60000)); localStorage.setItem("adminAttempts","0");} alert(t("adminWrongPassword")); } }
function adminLogout(){ if(!confirm(t("logoutConfirm"))) return; sessionStorage.removeItem("adminOk"); sessionStorage.removeItem("adminUntil"); $("#adminArea").classList.add("hidden"); $("#adminLogin").classList.remove("hidden"); alert(t("logoutDone")); }

function adminActive(){
  return sessionStorage.getItem("adminOk")==="true" && Number(sessionStorage.getItem("adminUntil")||"0")>Date.now();
}
function guardAdmin(){
  if(adminActive()) return true;
  sessionStorage.removeItem("adminOk");
  sessionStorage.removeItem("adminUntil");
  $("#adminArea").classList.add("hidden");
  $("#adminLogin").classList.remove("hidden");
  alert(t("adminExpired"));
  return false;
}

function restoreAdmin(){ if(adminActive()){ $("#adminLogin").classList.add("hidden"); $("#adminArea").classList.remove("hidden"); } }

async function deleteEntry(id){ const s=state(); const e=s.entries.find(x=>x.id===id); if(!e) return; if(!confirm(t("deleteConfirm"))) return; const reason=prompt(t("deleteReasonPrompt"),"")||""; await sendRemovalEmail(e,reason).catch(()=>{}); s.entries=s.entries.filter(x=>x.id!==id); delete s.paid[id]; saveState(s); renderAll(); alert(t("deleteEmailSent")); }

function renderAll(){ applyLanguage(); updateCountdown(); lockIfCutoff(); setupPaymentBox(); renderRanking(); renderParticipants(); renderPayments(); renderGames(); if(!$("#adminArea").classList.contains("hidden")) renderAdmin(); updateDynamic(); }

function bind(){ $$(".nav button").forEach(b=>b.addEventListener("click",()=>showSection(b.dataset.section))); $("#rankingList").addEventListener("click",e=>{ const id=e.target.dataset.rankToggle; if(!id) return; const detail=document.querySelector(`[data-rank-detail="${id}"]`); if(detail) detail.classList.toggle("hidden"); }); $("#languageSelect").addEventListener("change",e=>{currentLang=e.target.value; localStorage.setItem("bolao_lang",currentLang); renderAll();}); $("#paymentMethod").addEventListener("change",setupPaymentBox); $("#bracketForm").addEventListener("input",e=>{ if(e.target.matches('input[type="number"]') && Number(e.target.value)>20){ e.target.value=""; } if(e.target.matches("input,select")) updateDynamic(); }); $("#bracketForm").addEventListener("change",e=>{ if(e.target.matches("input,select")) updateDynamic(); }); $("#smartPick").addEventListener("click",()=>autoFill("smart")); $("#randomPick").addEventListener("click",()=>autoFill("random")); $("#saveEntry").addEventListener("click",saveEntry); $("#adminLoginBtn").addEventListener("click",adminLogin); $("#adminLogoutBtn").addEventListener("click",adminLogout); $("#backupCsv").addEventListener("click",backupCsv); $("#backupJson").addEventListener("click",backupJson); $("#masterCsv").addEventListener("click",masterCsv); $("#masterHtml").addEventListener("click",masterHtml); $("#clearData").addEventListener("click",()=>{ if(confirm(t("clearDataConfirm"))){ localStorage.removeItem(CONFIG.storeKey); renderAll(); }}); $("#adminReceipts").addEventListener("click",e=>{ if(!guardAdmin()) return; const id=e.target.dataset.id, act=e.target.dataset.act; if(!id) return; if(act==="open") openReceipt(id); if(act==="html") downloadReceipt(id); if(act==="emailp") mailReceipt(id,"participant"); if(act==="emaila") mailReceipt(id,"admin"); if(act==="delete") deleteEntry(id); }); $("#paymentsAdmin").addEventListener("change",e=>{ if(!guardAdmin()) return; const id=e.target.dataset.paid; if(!id) return; const s=state(); s.paid[id]=e.target.checked; saveState(s); renderAll(); }); $("#resultsAdmin").addEventListener("input",e=>{ if(!adminActive()) return; const card=e.target.closest("[data-real-match]"); if(card){ updateRealCard(card); const ga=parseScoreValue(card.querySelector('[data-real-field="goalsA"]').value), gb=parseScoreValue(card.querySelector('[data-real-field="goalsB"]').value); if(ga!==null && gb!==null && pickWinnerSide(ga,gb)) commitRealCard(card,true); } }); $("#resultsAdmin").addEventListener("change",e=>{ if(!guardAdmin()) return; const card=e.target.closest("[data-real-match]"); if(!card) return; const match=card.dataset.realMatch; const ga=parseScoreValue(card.querySelector('[data-real-field="goalsA"]').value), gb=parseScoreValue(card.querySelector('[data-real-field="goalsB"]').value), side=card.querySelector('[data-real-field="advanceSide"]').value; if((ga===null)!==(card.querySelector('[data-real-field="goalsA"]').value==="") || (gb===null)!==(card.querySelector('[data-real-field="goalsB"]').value==="")) { alert(`${t("invalidScore")} Match ${match}`); return;} if(ga!==null&&gb!==null){ const win=pickWinnerSide(ga,gb); if(win && side && side!==win){ alert(`${t("inconsistentAdvance")} Match ${match}`); return;} if(!win && !side){ alert(`${t("tieNeedsAdvance")} Match ${match}`); return;} const s=state(); s.results[match]={goalsA:ga,goalsB:gb,advanceSide:win||side}; saveState(s); renderAll(); } }); }
function init(){ $("#supportWhatsappBtn").href=CONFIG.whatsappGroup.link; setupEmailJs(); renderBracket(); bind(); restoreAdmin(); renderAll(); setInterval(updateCountdown,60000); showSection("entry"); }
document.addEventListener("DOMContentLoaded",init);
window.Bolao={openReceipt,downloadReceipt,mailReceipt,deleteEntry};
})();