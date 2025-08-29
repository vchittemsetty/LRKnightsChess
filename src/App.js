// src/App.jsx
import React, { useEffect, useState } from "react";

/*
  Single-file app:
  - Multi-section USCF/non-USCF
  - USCF-style pairings & tie-breaks (pragmatic)
  - TD override panel: swap players, force colors, force result, edit pairing
  - Public read-only view (opens in new window)
  - Standings table with round-by-round W/L/D/B and running totals
  - Plain JSX + basic styling classes (Tailwind optional)
*/

// ---------- Utilities ----------
const uid = () => Math.random().toString(36).slice(2, 9);
const clone = (o) => JSON.parse(JSON.stringify(o));

function parseResultToPoints(r) {
  if (!r) return { w: 0, b: 0 };
  if (r === "1-0") return { w: 1, b: 0 };
  if (r === "0-1") return { w: 0, b: 1 };
  if (r === "0.5-0.5" || r === "½-½") return { w: 0.5, b: 0.5 };
  return { w: 0, b: 0 };
}

function escapeHtml(s = "") {
  return s.replace(/[&<>"']/g, (m) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[m]));
}

// ---------- Pairing & tie-break helpers (USCF-practical) ----------
function seedCompare(a,b){
  if ((b.rating||0) !== (a.rating||0)) return (b.rating||0)-(a.rating||0);
  return a.name.localeCompare(b.name);
}
function havePlayed(a,b){ if(!a||!b) return false; return (a.opponents||[]).includes(b.id); }
function chooseColorsForPair(pA, pB){
  const aW=(pA.colors||[]).filter(c=>c==='W').length;
  const aB=(pA.colors||[]).filter(c=>c==='B').length;
  const bW=(pB.colors||[]).filter(c=>c==='W').length;
  const bB=(pB.colors||[]).filter(c=>c==='B').length;
  const aLast=(pA.colors||[]).slice(-2).join('');
  const bLast=(pB.colors||[]).slice(-2).join('');
  if(aLast==='WW' && bLast!=='WW') return {whiteId:pB.id,blackId:pA.id};
  if(aLast==='BB' && bLast!=='BB') return {whiteId:pA.id,blackId:pB.id};
  if(bLast==='WW' && aLast!=='WW') return {whiteId:pA.id,blackId:pB.id};
  if(bLast==='BB' && aLast!=='BB') return {whiteId:pB.id,blackId:pA.id};
  if(aW<=aB && bW>bB) return {whiteId:pA.id,blackId:pB.id};
  if(bW<=bB && aW>bB) return {whiteId:pB.id,blackId:pA.id};
  if((pA.rating||0) > (pB.rating||0)) return {whiteId:pB.id,blackId:pA.id};
  return {whiteId:pA.id,blackId:pB.id};
}

// build groups
function buildScoreGroups(players){
  const m=new Map();
  players.forEach(p=>{
    const k=p.score.toFixed(3);
    if(!m.has(k)) m.set(k,[]);
    m.get(k).push(p);
  });
  const groups=Array.from(m.entries()).map(([k,arr])=>({score:+k,players:arr}));
  groups.sort((a,b)=>b.score-a.score);
  groups.forEach(g=>g.players.sort(seedCompare));
  return groups;
}

// pair within group using top-half vs bottom-half, floating lowest if needed
function pairWithinGroup(groupPlayers, sectionPlayers){
  const n=groupPlayers.length;
  const topCount=Math.ceil(n/2);
  const top=groupPlayers.slice(0,topCount);
  let bottom=groupPlayers.slice(topCount);
  const pairings=[];
  const floated=[];
  for(let i=0;i<top.length;i++){
    const t=top[i];
    if(i>=bottom.length){ floated.push(t); continue; }
    let chosenIdx=-1;
    for(let j=i;j<bottom.length;j++){
      if(!havePlayed(t,bottom[j])) { chosenIdx=j; break; }
    }
    if(chosenIdx===-1){
      for(let j=0;j<bottom.length;j++){
        if(!bottom[j]._used){ chosenIdx=j; break; }
      }
    }
    if(chosenIdx===-1){ floated.push(t); continue; }
    const chosen=bottom.splice(chosenIdx,1)[0];
    const pA = sectionPlayers.find(p=>p.id===t.id) || t;
    const pB = sectionPlayers.find(p=>p.id===chosen.id) || chosen;
    const {whiteId,blackId}=chooseColorsForPair(pA,pB);
    pairings.push({whiteId,blackId,isBye:false,result:null,tdNote:null});
    if(!pA.opponents.includes(pB.id)) pA.opponents.push(pB.id);
    if(!pB.opponents.includes(pA.id)) pB.opponents.push(pA.id);
    pA.colors = pA.colors || []; pB.colors = pB.colors || [];
    if(whiteId===pA.id){ pA.colors.push('W'); pB.colors.push('B'); }
    else { pA.colors.push('B'); pB.colors.push('W'); }
  }
  while(bottom.length){ floated.push(bottom.shift()); }
  return {pairings,floated};
}

// main engine
function uscfPairingEngine(section){
  const players = clone(section.players).filter(p=>!p.withdrawn);
  players.sort((a,b)=>{
    if(b.score!==a.score) return b.score-a.score;
    if((b.rating||0)!==(a.rating||0)) return (b.rating||0)-(a.rating||0);
    return a.name.localeCompare(b.name);
  });
  const groups = buildScoreGroups(players);
  let allPairings=[];
  for(let gi=0; gi<groups.length; gi++){
    const {pairings,floated} = pairWithinGroup(groups[gi].players, players);
    allPairings.push(...pairings);
    if(floated.length){
      if(gi+1<groups.length) groups[gi+1].players = groups[gi+1].players.concat(floated);
      else groups[gi].leftover = (groups[gi].leftover||[]).concat(floated);
    }
  }
  // leftovers
  const leftovers = (groups.length? groups[groups.length-1].leftover||[] : []);
  const unpaired = players.filter(p=>{
    return !allPairings.some(pi=>pi.whiteId===p.id||pi.blackId===p.id);
  }).concat(leftovers);
  // pair leftovers
  while(unpaired.length>=2){
    const a=unpaired.shift();
    let idx = unpaired.findIndex(x=>!havePlayed(a,x));
    if(idx===-1) idx=0;
    const b=unpaired.splice(idx,1)[0];
    const pA=players.find(p=>p.id===a.id)||a;
    const pB=players.find(p=>p.id===b.id)||b;
    const {whiteId,blackId}=chooseColorsForPair(pA,pB);
    allPairings.push({whiteId,blackId,isBye:false,result:null,tdNote:null});
    if(!pA.opponents.includes(pB.id)) pA.opponents.push(pB.id);
    if(!pB.opponents.includes(pA.id)) pB.opponents.push(pA.id);
    pA.colors=pA.colors||[]; pB.colors=pB.colors||[];
    if(whiteId===pA.id){ pA.colors.push('W'); pB.colors.push('B'); } else { pA.colors.push('B'); pB.colors.push('W'); }
  }
  // one remaining => bye
  const remaining = players.filter(p=>!allPairings.some(pi=>pi.whiteId===p.id||pi.blackId===p.id));
  if(remaining.length===1){
    // pick lowest eligible (lowest score then lowest rating)
    const candidate = remaining.sort((a,b)=> a.score-b.score || (a.rating||0)-(b.rating||0)).find(p=>!p.hadBye) || remaining[0];
    allPairings.push({whiteId:candidate.id,blackId:null,isBye:true,result:"1-0",tdNote:"auto-bye"});
    const idx = players.findIndex(p=>p.id===candidate.id);
    if(idx>=0) players[idx].hadBye=true;
  } else if(remaining.length>1){
    // pair them as fallback
    while(remaining.length>=2){
      const a=remaining.shift(); const b=remaining.shift();
      const pA=players.find(p=>p.id===a.id)||a; const pB=players.find(p=>p.id===b.id)||b;
      const {whiteId,blackId}=chooseColorsForPair(pA,pB);
      allPairings.push({whiteId,blackId,isBye:false,result:null,tdNote:null});
    }
    if(remaining.length===1){
      const c=remaining.shift();
      allPairings.push({whiteId:c.id,blackId:null,isBye:true,result:"1-0",tdNote:"auto-bye"});
    }
  }

  return {pairings:allPairings, players};
}

// tie-breaks
function computeTieBreaks(section){
  const byId = new Map(section.players.map(p=>[p.id,p]));
  section.players.forEach(p=>{
    p.opponents = p.opponents||[];
    p.results = p.results||[];
  });
  section.players.forEach(p=>{
    const oppScores = p.opponents.map(id=>byId.get(id)?.score||0).sort((a,b)=>a-b);
    const buch = oppScores.reduce((s,v)=>s+v,0);
    let median = buch;
    if(oppScores.length>2) median = buch - oppScores[0] - oppScores[oppScores.length-1];
    let sb=0;
    p.results.forEach(r=>{
      if(r.isBye) return;
      const opp = byId.get(r.oppId);
      if(!opp) return;
      if(r.result===1) sb+=opp.score;
      else if(r.result===0.5) sb+=opp.score/2;
    });
    let run=0; let cum=0;
    const sorted = (p.results||[]).slice().sort((a,b)=>a.round-b.round);
    sorted.forEach(r=>{ run+=r.result; cum+=run; });
    p.buchholz=+buch.toFixed(3); p.median=+median.toFixed(3); p.sb=+sb.toFixed(3); p.cumulative=+cum.toFixed(3);
  });
}

function directEncounter(section,aId,bId){
  const a = section.players.find(p=>p.id===aId);
  if(!a) return 0;
  const r = (a.results||[]).find(x=>x.oppId===bId);
  if(!r) return 0;
  if(r.result===1) return 1;
  if(r.result===0) return -1;
  return 0;
}

function standingsComparator(section,A,B){
  if(B.score!==A.score) return B.score-A.score;
  if((B.buchholz||0)!==(A.buchholz||0)) return (B.buchholz||0)-(A.buchholz||0);
  if((B.median||0)!==(A.median||0)) return (B.median||0)-(A.median||0);
  if((B.sb||0)!=(A.sb||0)) return (B.sb||0)-(A.sb||0);
  const de=directEncounter(section,A.id,B.id);
  if(de===1) return -1;
  if(de===-1) return 1;
  if((B.cumulative||0)!=(A.cumulative||0)) return (B.cumulative||0)-(A.cumulative||0);
  return (B.rating||0)-(A.rating||0);
}

// ---------- Main App ----------
export default function App(){
  const [sections,setSections] = useState(()=>{ try{ const raw=sessionStorage.getItem('uscf_sections_v2'); return raw?JSON.parse(raw):[] }catch(e){return []} });
  const [activeSection, setActiveSection] = useState(null);
  const [tdMode, setTdMode] = useState(false); // if true show TD override UI

  useEffect(()=>{ try{ sessionStorage.setItem('uscf_sections_v2', JSON.stringify(sections)) }catch(e){} }, [sections]);

  // add section
  function addSection(name,uscf){
    const sec = { id: uid(), name: name||`Section ${sections.length+1}`, uscfMode:!!uscf, players:[], rounds:[], locked:false, plannedRounds:0 };
    setSections(prev=>[...prev,sec]); setActiveSection(sec.id);
  }

  function registerPlayer(sectionId, {name, uscfId=null, rating=0}){
    setSections(all=>all.map(sec=> sec.id===sectionId ? {...sec, players:[...sec.players, { id:uid(), name, uscfId, rating:Number(rating)||0, score:0, opponents:[], colors:[], results:[], hadBye:false, withdrawn:false } ] } : sec ));
  }

  function withdrawPlayer(sectionId, playerId){
    if(!confirm('Mark player as withdrawn?')) return;
    setSections(all=>all.map(sec=> sec.id===sectionId ? {...sec, players: sec.players.map(p=> p.id===playerId?{...p, withdrawn:true}:p)} : sec ));
  }

  function lockSection(sectionId, plannedRounds=4){
    setSections(all=>all.map(sec=> sec.id===sectionId?{...sec, locked:true, plannedRounds}:sec));
  }

  function startNextRound(sectionId){
    setSections(all=>all.map(sec=>{
      if(sec.id!==sectionId) return sec;
      if(!sec.locked) { alert('Lock section first'); return sec; }
      if(sec.plannedRounds && sec.rounds.length>=sec.plannedRounds){ alert('All rounds started'); return sec; }
      const engine = uscfPairingEngine(sec);
      // engine.players contains clone with updated opponents/colors; but we want to merge these into our real players
      // apply bye points immediately and add results entries for byes
      const playersCopy = clone(sec.players);
      const roundNumber = sec.rounds.length+1;
      // ensure playersCopy have opponents arrays
      engine.pairings.forEach(p=>{
        if(p.isBye){
          const pl = playersCopy.find(x=>x.id===p.whiteId);
          if(pl){
            if(!pl.hadBye) pl.hadBye = true;
            pl.score = +(pl.score + 1).toFixed(3);
            pl.results = pl.results || [];
            pl.results.push({ round: roundNumber, oppId:null, result:1, isBye:true });
            if(!pl.opponents) pl.opponents = [];
          }
        } else {
          const w = playersCopy.find(x=>x.id===p.whiteId);
          const b = playersCopy.find(x=>x.id===p.blackId);
          if(w && b){
            if(!w.opponents.includes(b.id)) w.opponents.push(b.id);
            if(!b.opponents.includes(w.id)) b.opponents.push(w.id);
            w.colors = w.colors || []; b.colors = b.colors || [];
            w.colors.push('W'); b.colors.push('B');
          }
        }
      });
      const newRound = { number: roundNumber, pairings: engine.pairings.map(p=>({...p})) };
      const newSec = {...sec, players:playersCopy, rounds:[...sec.rounds, newRound]};
      computeTieBreaks(newSec);
      return newSec;
    }));
  }

  // update result safely (deduct old points before apply new)
  function updateResult(sectionId, roundIdx, pairingIdx, newResult, tdNote){
    setSections(all=>all.map(sec=>{
      if(sec.id!==sectionId) return sec;
      const secCopy = clone(sec);
      const round = secCopy.rounds[roundIdx];
      if(!round) return secCopy;
      const pairing = round.pairings[pairingIdx];
      if(!pairing) return secCopy;
      const roundNumber = round.number;
      const whiteId = pairing.whiteId;
      const blackId = pairing.blackId;
      const isBye = pairing.isBye;
      const pW = secCopy.players.find(p=>p.id===whiteId);
      const pB = blackId? secCopy.players.find(p=>p.id===blackId): null;
      // remove previous
      const prev = pairing.result;
      if(prev){
        const prevPts = parseResultToPoints(prev);
        if(pW) pW.score = +(pW.score - prevPts.w).toFixed(3);
        if(pB) pB.score = +(pB.score - prevPts.b).toFixed(3);
        if(isBye){
          if(pW) pW.results = (pW.results||[]).filter(r=>!(r.round===roundNumber && r.isBye));
        } else {
          if(pW) pW.results = (pW.results||[]).filter(r=>!(r.round===roundNumber && r.oppId===blackId));
          if(pB) pB.results = (pB.results||[]).filter(r=>!(r.round===roundNumber && r.oppId===whiteId));
        }
      }
      // apply new
      pairing.result = newResult;
      if(tdNote) pairing.tdNote = tdNote;
      if(isBye){
        const pts = newResult? parseResultToPoints(newResult) : {w:1,b:0};
        if(pW){
          pW.score = +(pW.score + pts.w).toFixed(3);
          pW.results = pW.results || [];
          pW.results = pW.results.filter(r=>!(r.round===roundNumber && r.isBye));
          pW.results.push({round:roundNumber, oppId:null, result: pts.w, isBye:true});
          pW.hadBye = true;
        }
      } else {
        const pts = parseResultToPoints(newResult);
        if(pW){
          pW.score = +(pW.score + pts.w).toFixed(3);
          pW.results = pW.results || [];
          pW.results = pW.results.filter(r=>!(r.round===roundNumber && r.oppId===blackId));
          pW.results.push({round:roundNumber, oppId:blackId, result: pts.w, isBye:false});
          if(!pW.opponents.includes(blackId)) pW.opponents.push(blackId);
        }
        if(pB){
          pB.score = +(pB.score + pts.b).toFixed(3);
          pB.results = pB.results || [];
          pB.results = pB.results.filter(r=>!(r.round===roundNumber && r.oppId===whiteId));
          pB.results.push({round:roundNumber, oppId:whiteId, result: pts.b, isBye:false});
          if(!pB.opponents.includes(whiteId)) pB.opponents.push(whiteId);
        }
      }
      computeTieBreaks(secCopy);
      return secCopy;
    }));
  }

  // TD overrides: swap players on board
  function tdSwapPlayers(sectionId, roundIdx, boardIdx){
    setSections(all=>all.map(sec=>{
      if(sec.id!==sectionId) return sec;
      const secCopy = clone(sec);
      const round = secCopy.rounds[roundIdx];
      if(!round) return secCopy;
      const pairing = round.pairings[boardIdx];
      if(!pairing) return secCopy;
      // swap white/black ids (and swap colors in players)
      const tmpW = pairing.whiteId;
      pairing.whiteId = pairing.blackId;
      pairing.blackId = tmpW;
      pairing.tdNote = (pairing.tdNote || "") + " | TD swapped colors/players";
      // update color histories minimally (not retroactive)
      return secCopy;
    }));
  }

  // TD force replace a player on a board (either white or black)
  function tdReplacePlayer(sectionId, roundIdx, boardIdx, which, newPlayerId){
    setSections(all=>all.map(sec=>{
      if(sec.id!==sectionId) return sec;
      const secCopy = clone(sec);
      const round = secCopy.rounds[roundIdx];
      if(!round) return secCopy;
      const pairing = round.pairings[boardIdx];
      if(!pairing) return secCopy;
      if(which==='white') pairing.whiteId = newPlayerId;
      else pairing.blackId = newPlayerId;
      pairing.tdNote = (pairing.tdNote||"") + ` | TD replaced ${which}`;
      computeTieBreaks(secCopy);
      return secCopy;
    }));
  }

  // TD force color (assign white to chosen ID)
  function tdForceColor(sectionId, roundIdx, boardIdx, playerIdAsWhite){
    setSections(all=>all.map(sec=>{
      if(sec.id!==sectionId) return sec;
      const secCopy = clone(sec);
      const round = secCopy.rounds[roundIdx];
      if(!round) return secCopy;
      const pairing = round.pairings[boardIdx];
      if(!pairing) return secCopy;
      if(pairing.whiteId !== playerIdAsWhite){
        // swap
        const tmp = pairing.whiteId; pairing.whiteId = pairing.blackId; pairing.blackId = tmp;
      }
      pairing.tdNote = (pairing.tdNote||"") + " | TD forced color";
      return secCopy;
    }));
  }

  // Print pairing sheet
  function printPairings(sec, round){
    const html=[];
    html.push("<html><head><meta charset='utf-8'><title>Pairings</title>");
    html.push("<style>body{font-family:sans-serif;padding:20px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #222;padding:6px}th{background:#eee}</style>");
    html.push("</head><body>");
    html.push(`<h2>${escapeHtml(sec.name)} — Round ${round.number}</h2>`);
    html.push("<table><thead><tr><th>Board</th><th>White</th><th>Black</th><th>Result</th></tr></thead><tbody>");
    round.pairings.forEach((p,i)=>{
      const w = sec.players.find(x=>x.id===p.whiteId);
      const b = p.blackId? sec.players.find(x=>x.id===p.blackId): null;
      html.push(`<tr><td>${i+1}</td><td>${escapeHtml(w? w.name : "—")}</td><td>${escapeHtml(b? b.name : (p.isBye?"BYE":"—"))}</td><td>${escapeHtml(p.result||"")}</td></tr>`);
    });
    html.push("</tbody></table></body></html>");
    const w=window.open("","_blank","width=800,height=900"); if(!w){ alert("Allow popups"); return; }
    w.document.write(html.join("")); w.document.close(); w.focus(); w.print();
  }

  // export section
  function exportSection(sectionId){
    const s = sections.find(x=>x.id===sectionId); if(!s) return;
    const blob = new Blob([JSON.stringify(s,null,2)],{type:"application/json"}); const url=URL.createObjectURL(blob);
    const a=document.createElement('a'); a.href=url; a.download=`${s.name.replace(/\s+/g,'_')}_export.json`; a.click(); URL.revokeObjectURL(url);
  }

  // import section (adds new)
  function importSection(file){
    const r=new FileReader(); r.onload=e=>{
      try{
        const j=JSON.parse(e.target.result);
        if(!j.name || !Array.isArray(j.players)) throw new Error("Invalid");
        const sec = {...j, id:uid()};
        setSections(all=>[...all,sec]); alert("Imported");
      }catch(err){ alert("Import failed: "+err.message); }
    }; r.readAsText(file);
  }

  // get standings with round-by-round history display data
  function getStandingsWithHistory(sec){
    const copy = clone(sec);
    computeTieBreaks(copy);
    const rows = copy.players.map(p=>({...p})).sort((a,b)=> standingsComparator(copy,a,b));
    // build per-round cells
    const totalRounds = sec.rounds.length;
    const playerIndexById = {}; rows.forEach((p,i)=> playerIndexById[p.id]=i+1);
    // for each player build history cells
    rows.forEach(p=>{
      p.roundCells = [];
      let running=0;
      for(let rIdx=0;rIdx<totalRounds;rIdx++){
        const round = sec.rounds[rIdx];
        if(!round){ p.roundCells.push({label:'', pts:running}); continue; }
        // find pairing involving p
        const pairing = round.pairings.find(pd=>pd.whiteId===p.id || pd.blackId===p.id || (pd.isBye && pd.whiteId===p.id));
        if(!pairing){ p.roundCells.push({label:'—', pts:running}); continue; }
        const isWhite = pairing.whiteId===p.id;
        const oppId = pairing.isBye? null : (isWhite? pairing.blackId : pairing.whiteId);
        const opp = oppId? sec.players.find(x=>x.id===oppId) : null;
        const oppIndex = opp? playerIndexById[opp.id] : null;
        const res = pairing.result || (pairing.isBye? "1-0" : null);
        let label='';
        if(pairing.isBye && pairing.whiteId===p.id){ label = 'B'; running += 1; }
        else if(res){
          if(res==='1-0'){ label = isWhite? `W${oppIndex||''}` : `L${oppIndex||''}`; running += isWhite?1:0; }
          else if(res==='0-1'){ label = isWhite? `L${oppIndex||''}` : `W${oppIndex||''}`; running += isWhite?0:1; }
          else if(res==='0.5-0.5' || res==='½-½'){ label = `D${oppIndex||''}`; running += 0.5; }
        } else { label = opp? (isWhite? `v${oppIndex}` : `v${oppIndex}`) : '—'; }
        p.roundCells.push({label, pts: +running.toFixed(2)});
      }
    });
    return rows;
  }

  // Open public view in new window with sectionId in query
  function openPublicView(sectionId){
    const w = window.open("", "_blank");
    if(!w){ alert("Allow popups"); return; }
    // build HTML for public view
    const sec = sections.find(s=>s.id===sectionId);
    if(!sec){ w.document.write("<p>Section not found</p>"); return; }
    const standings = getStandingsWithHistory(sec);
    const html=[];
    html.push("<html><head><meta charset='utf-8'><title>Public View</title><style>body{font-family:sans-serif;padding:16px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #222;padding:6px}th{background:#eee}</style></head><body>");
    html.push(`<h2>${escapeHtml(sec.name)} — Public View</h2>`);
    html.push("<h3>Pairings</h3>");
    sec.rounds.forEach(r=>{
      html.push(`<h4>Round ${r.number}</h4><table><thead><tr><th>Board</th><th>White</th><th>Black</th><th>Result</th></tr></thead><tbody>`);
      r.pairings.forEach((p,i)=>{
        const wpl = sec.players.find(x=>x.id===p.whiteId); const bpl = p.blackId?sec.players.find(x=>x.id===p.blackId):null;
        html.push(`<tr><td>${i+1}</td><td>${escapeHtml(wpl? wpl.name : '—')}</td><td>${escapeHtml(bpl? bpl.name : (p.isBye?'BYE':'—'))}</td><td>${escapeHtml(p.result||'')}</td></tr>`);
      });
      html.push("</tbody></table>");
    });
    html.push("<h3>Standings</h3>");
    html.push("<table><thead><tr><th>#</th><th>Name</th>");
    for(let c=1;c<=sec.rounds.length;c++) html.push(`<th>R${c}</th>`);
    html.push("<th>Pts</th><th>Buchholz</th><th>SB</th></tr></thead><tbody>");
    standings.forEach((pl,i)=>{
      html.push(`<tr><td>${i+1}</td><td>${escapeHtml(pl.name)}</td>`);
      pl.roundCells.forEach(rc=>html.push(`<td>${escapeHtml(rc.label)} (${rc.pts.toFixed(2)})</td>`));
      html.push(`<td>${(pl.score||0).toFixed(2)}</td><td>${(pl.buchholz||0).toFixed(2)}</td><td>${(pl.sb||0).toFixed(2)}</td></tr>`);
    });
    html.push("</tbody></table></body></html>");
    w.document.write(html.join('')); w.document.close();
  }

  // ---------- UI rendering ----------
  return (
    <div className="min-h-screen bg-gray-100 p-6">
      <div className="max-w-7xl mx-auto">
        <header className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold">Win-like TD Web — USCF Swiss</h1>
            <div className="text-sm text-gray-600">TD overrides & public view; round-by-round standings</div>
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={tdMode} onChange={e=>setTdMode(e.target.checked)} /> TD Mode
            </label>
            <button onClick={()=>addSection("Open (USCF)", true)} className="px-3 py-2 bg-indigo-600 text-white rounded">Add USCF</button>
            <button onClick={()=>addSection("Casual", false)} className="px-3 py-2 bg-green-600 text-white rounded">Add Non-USCF</button>
            <label className="px-3 py-2 bg-gray-200 rounded cursor-pointer">
              Import
              <input type="file" accept="application/json" onChange={e=>e.target.files?.[0] && importSection(e.target.files[0])} style={{display:'none'}} />
            </label>
          </div>
        </header>

        {/* sections list */}
        <div className="grid gap-3 mb-6">
          {sections.map(s=>(
            <div key={s.id} className="bg-white p-3 rounded shadow flex justify-between items-center">
              <div>
                <div className="font-semibold">{s.name} {s.uscfMode? '(USCF)':''}</div>
                <div className="text-sm text-gray-600">Players: {s.players.length} · Rounds: {s.rounds.length} · {s.locked? 'Locked':'Open'}</div>
              </div>
              <div className="flex gap-2">
                <button onClick={()=>setActiveSection(s.id)} className="px-2 py-1 bg-gray-800 text-white rounded">Manage</button>
                {!s.locked ? <button onClick={()=>{ const pr=prompt('Planned rounds?','4'); lockSection(s.id, Math.max(1, parseInt(pr||'4',10)||4)); }} className="px-2 py-1 bg-yellow-500 text-white rounded">Lock & Start</button> :
                  <><button onClick={()=>exportSection(s.id)} className="px-2 py-1 bg-gray-200 rounded">Export</button>
                  <button onClick={()=>openPublicView(s.id)} className="px-2 py-1 bg-blue-500 text-white rounded">Open Public View</button></>}
              </div>
            </div>
          ))}
        </div>

        {/* active section panel */}
        {activeSection && (()=> {
          const sec = sections.find(x=>x.id===activeSection); if(!sec) return null;
          const standingsWithHistory = getStandingsWithHistory(sec);
          return (
            <div className="bg-white p-4 rounded shadow">
              <div className="flex justify-between items-start">
                <div>
                  <h2 className="text-xl font-bold">{sec.name} Management {sec.uscfMode? '(USCF)':''}</h2>
                  <div className="text-sm text-gray-600">Planned rounds: {sec.plannedRounds||'—'}</div>
                </div>
                <div className="flex gap-2">
                  <button onClick={()=>setActiveSection(null)} className="px-2 py-1 bg-gray-200 rounded">Close</button>
                  <button onClick={()=>{ if(!confirm('Reset section?')) return; setSections(all=>all.map(s=> s.id===sec.id? {...s, players:[], rounds:[], locked:false, plannedRounds:0} : s)); }} className="px-2 py-1 bg-red-500 text-white rounded">Reset</button>
                </div>
              </div>

              {/* registration */}
              {!sec.locked ? <RegistrationPanel isUSCF={sec.uscfMode} onRegister={(d)=>registerPlayer(sec.id,d)} players={sec.players} onWithdraw={(pid)=>withdrawPlayer(sec.id,pid)} /> :
                <div className="text-sm text-gray-700 mb-3">Section locked. You may start rounds and enter results.</div> }

              {/* rounds controls */}
              {sec.locked && (
                <div>
                  <div className="flex items-center gap-3 mb-3">
                    <button onClick={()=>startNextRound(sec.id)} className="px-3 py-2 bg-purple-600 text-white rounded">Start Next Round</button>
                    <div className="text-sm text-gray-600">Rounds started: {sec.rounds.length} / {sec.plannedRounds||'—'}</div>
                    <div className="ml-auto text-sm font-medium">Leader: { (standingsWithHistory[0]||{}).name||'—' } — {(standingsWithHistory[0]?.score||0).toFixed(2)} pts</div>
                  </div>

                  {/* rounds list */}
                  <div className="space-y-4">
                    {sec.rounds.map((round,rIdx)=>(
                      <div key={rIdx} className="border rounded p-3 bg-gray-50">
                        <div className="flex justify-between items-center mb-2">
                          <div className="font-semibold">Round {round.number}</div>
                          <div className="flex gap-2 items-center">
                            <button onClick={()=>printPairings(sec,round)} className="px-2 py-1 bg-gray-500 text-white rounded">Print Pairings</button>
                            <button onClick={()=>exportSection(sec.id)} className="px-2 py-1 bg-gray-200 rounded">Export Section</button>
                          </div>
                        </div>

                        <table className="w-full border-collapse">
                          <thead>
                            <tr className="bg-white">
                              <th className="border px-2 py-1">Board</th>
                              <th className="border px-2 py-1">White</th>
                              <th className="border px-2 py-1">Black</th>
                              <th className="border px-2 py-1">Result</th>
                              <th className="border px-2 py-1">TD</th>
                            </tr>
                          </thead>
                          <tbody>
                            {round.pairings.map((p,pIdx)=>{
                              const w = sec.players.find(pl=>pl.id===p.whiteId);
                              const b = p.blackId? sec.players.find(pl=>pl.id===p.blackId): null;
                              return (
                                <tr key={pIdx}>
                                  <td className="border px-2 py-1">{pIdx+1}</td>
                                  <td className="border px-2 py-1">{w? w.name : '—'}</td>
                                  <td className="border px-2 py-1">{b? b.name : (p.isBye? 'BYE':'—')}</td>
                                  <td className="border px-2 py-1">
                                    {p.isBye ? <span>1-0 (bye)</span> :
                                      <select value={p.result||''} onChange={e=> updateResult(sec.id, rIdx, pIdx, e.target.value)} className="px-2 py-1 border rounded">
                                        <option value="">Select</option>
                                        <option value="1-0">1-0</option>
                                        <option value="0-1">0-1</option>
                                        <option value="0.5-0.5">0.5-0.5</option>
                                      </select>
                                    }
                                  </td>
                                  <td className="border px-2 py-1">
                                    <div className="flex gap-1">
                                      {tdMode && !p.isBye && <button title="Swap players on board" onClick={()=>tdSwapPlayers(sec.id, rIdx, pIdx)} className="px-2 py-1 bg-yellow-200 rounded text-sm">Swap</button>}
                                      {tdMode && <button title="Force White" onClick={()=> { const id = prompt('Player ID to force White (leave blank to toggle)'); if(id) tdForceColor(sec.id, rIdx, pIdx, id); }} className="px-2 py-1 bg-blue-200 rounded text-sm">Force Color</button>}
                                      {tdMode && <button title="Replace player" onClick={()=>{ const which = prompt('Replace which side? (white|black)'); const np = prompt('New player id'); if(which && np) tdReplacePlayer(sec.id, rIdx, pIdx, which, np); }} className="px-2 py-1 bg-red-200 rounded text-sm">Replace</button>}
                                      {p.tdNote && <span title={p.tdNote} className="text-xs text-gray-600">TD</span>}
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    ))}
                  </div>

                  {/* standings with round-by-round */}
                  <div className="mt-6">
                    <h3 className="font-semibold mb-2">Standings (round-by-round)</h3>
                    <StandingsGrid section={sec} rows={standingsWithHistory} tdMode={tdMode} />
                  </div>
                </div>
              )}

            </div>
          );
        })()}

      </div>
    </div>
  );
}

// ---------- Subcomponents ----------
function RegistrationPanel({ isUSCF, onRegister, players, onWithdraw }){
  const [name,setName]=useState(''); const [uscfId,setUscfId]=useState(''); const [rating,setRating]=useState('');
  return (
    <div className="mb-4 grid grid-cols-1 md:grid-cols-4 gap-3">
      <div>
        <label className="text-sm block mb-1">Name</label>
        <input value={name} onChange={e=>setName(e.target.value)} className="w-full px-2 py-1 border rounded" />
      </div>
      {isUSCF && <>
        <div>
          <label className="text-sm block mb-1">USCF ID</label>
          <input value={uscfId} onChange={e=>setUscfId(e.target.value)} className="w-full px-2 py-1 border rounded" />
        </div>
        <div>
          <label className="text-sm block mb-1">Rating</label>
          <input value={rating} onChange={e=>setRating(e.target.value)} className="w-full px-2 py-1 border rounded" type="number" />
        </div>
      </>}
      <div className="flex items-end gap-2">
        <button onClick={()=>{ if(!name.trim()) return alert('Enter name'); onRegister({name:name.trim(), uscfId:uscfId.trim()||null, rating: Number(rating)||0}); setName(''); setUscfId(''); setRating(''); }} className="px-3 py-2 bg-blue-600 text-white rounded">Add Player</button>
      </div>

      <div className="md:col-span-4">
        <div className="text-sm font-semibold">Players</div>
        <ul className="mt-2 max-h-48 overflow-auto border rounded">
          {players.map(p=>(
            <li key={p.id} className="p-2 flex justify-between border-b">
              <div>
                <div className="font-medium">{p.name}</div>
                <div className="text-xs text-gray-600">{isUSCF? `USCF: ${p.uscfId||'—'} · Rating: ${p.rating||'—'}` : `Rating: ${p.rating||'—'}`}</div>
              </div>
              <div className="flex gap-2 items-center">
                <div className="text-xs text-gray-500">{p.score?.toFixed?.(2)??'0.00'} pts</div>
                <button onClick={()=>onWithdraw(p.id)} className="px-2 py-1 bg-yellow-200 rounded text-sm">Withdraw</button>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function StandingsGrid({ section, rows }){
  const rounds = section.rounds.length;
  return (
    <div className="overflow-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr className="bg-white">
            <th className="border px-2 py-1">#</th>
            <th className="border px-2 py-1">Player</th>
            {[...Array(rounds)].map((_,i)=><th key={i} className="border px-2 py-1">R{i+1}</th>)}
            <th className="border px-2 py-1">Pts</th>
            <th className="border px-2 py-1">Buchholz</th>
            <th className="border px-2 py-1">SB</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r,idx)=>(
            <tr key={r.id} className={idx===0? 'bg-amber-50':''}>
              <td className="border px-2 py-1">{idx+1}</td>
              <td className="border px-2 py-1">{r.name}</td>
              {r.roundCells.map((c,i)=>(<td key={i} className="border px-2 py-1"><div className="text-sm">{c.label}</div><div className="text-xs text-gray-500">{c.pts.toFixed(2)}</div></td>))}
              <td className="border px-2 py-1">{(r.score||0).toFixed(2)}</td>
              <td className="border px-2 py-1">{(r.buchholz||0).toFixed(2)}</td>
              <td className="border px-2 py-1">{(r.sb||0).toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
