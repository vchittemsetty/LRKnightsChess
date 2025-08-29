// src/App.js
import React, { useEffect, useState, useRef } from "react";
import { gapi } from "gapi-script";

/**
 * Google Sheets backed Swiss Tournament Manager (WinTD-like)
 *
 * - TD dashboard: manage multiple sections in parallel
 * - Public view: read-only pairings + standings auto-refresh (poll every 5s)
 * - Pairing engine (practical USCF-style) + tiebreaks
 * - TD overrides: swap, replace, force color, edit result
 * - Uses gapi client to read/write Google Sheets
 *
 * Requires:
 * - env: REACT_APP_GOOGLE_CLIENT_ID, REACT_APP_GOOGLE_API_KEY, REACT_APP_SPREADSHEET_ID
 * - Sheet structure: see the README in code comments above
 */

// -------------------- Configuration --------------------
const CLIENT_ID = process.env.REACT_APP_GOOGLE_CLIENT_ID;
const API_KEY = process.env.REACT_APP_GOOGLE_API_KEY;
const SPREADSHEET_ID = process.env.REACT_APP_SPREADSHEET_ID;
const SCOPES = "https://www.googleapis.com/auth/spreadsheets"; // read/write
const POLL_MS = 5000; // public view polling interval

// -------------------- Utilities --------------------
const uid = () => Math.random().toString(36).slice(2, 9);
const safeSplit = (s) => (s ? String(s).split(",").map(x => x.trim()).filter(Boolean) : []);
const safeJoin = (arr) => (Array.isArray(arr) ? arr.join(",") : "");
const parseBool = (s) => String(s).toLowerCase() === "true";

function parseNumber(n) {
  const v = Number(n);
  return Number.isFinite(v) ? v : 0;
}

// Escape HTML for printing
function escapeHtml(s = "") {
  return String(s).replace(/[&<>"']/g, (m) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m])
  );
}

// -------------------- Pairing & tiebreak engine (pragmatic USCF) --------------------
function seedCompare(a, b) {
  if ((b.rating || 0) !== (a.rating || 0)) return (b.rating || 0) - (a.rating || 0);
  return a.name.localeCompare(b.name);
}
function havePlayed(a,b){ if(!a||!b) return false; return (a.opponents||[]).includes(b.id); }
function chooseColorsForPair(pA,pB){
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

function uscfPairingEngine(playersRaw = []) {
  // playersRaw: array of {id,name,rating,score,opponents:[],colors:[],hadBye,withdrawn}
  const players = JSON.parse(JSON.stringify(playersRaw)).filter(p => !p.withdrawn);
  players.sort((a,b) => {
    if(b.score !== a.score) return b.score - a.score;
    if((b.rating||0) !== (a.rating||0)) return (b.rating||0) - (a.rating||0);
    return a.name.localeCompare(b.name);
  });

  // build groups
  const byScore = new Map();
  players.forEach(p => {
    const key = p.score.toFixed(3);
    if(!byScore.has(key)) byScore.set(key, []);
    byScore.get(key).push(p);
  });
  const groups = Array.from(byScore.entries()).map(([k,arr])=>({score:+k, players:arr})).sort((a,b)=>b.score-a.score);
  groups.forEach(g => g.players.sort(seedCompare));

  let allPairings = [];

  for(let gi=0; gi<groups.length; gi++){
    const group = groups[gi];
    const arr = group.players.slice();
    const topCount = Math.ceil(arr.length / 2);
    const top = arr.slice(0, topCount);
    let bottom = arr.slice(topCount);

    const floated = [];
    for(let i=0;i<top.length;i++){
      const t = top[i];
      if(i >= bottom.length){ floated.push(t); continue; }
      let chosenIdx = -1;
      for(let j=i;j<bottom.length;j++){
        if(!havePlayed(t, bottom[j])){ chosenIdx = j; break; }
      }
      if(chosenIdx === -1){
        for(let j=0;j<bottom.length;j++){ if(!bottom[j]._used){ chosenIdx = j; break; } }
      }
      if(chosenIdx === -1){ floated.push(t); continue; }
      const chosen = bottom.splice(chosenIdx,1)[0];
      const pA = players.find(x=>x.id===t.id) || t;
      const pB = players.find(x=>x.id===chosen.id) || chosen;
      const {whiteId,blackId} = chooseColorsForPair(pA,pB);
      allPairings.push({whiteId,blackId,isBye:false,result:null,tdNote:null});
      if(!pA.opponents) pA.opponents = [];
      if(!pB.opponents) pB.opponents = [];
      if(!pA.opponents.includes(pB.id)) pA.opponents.push(pB.id);
      if(!pB.opponents.includes(pA.id)) pB.opponents.push(pA.id);
      pA.colors = pA.colors || []; pB.colors = pB.colors || [];
      if(whiteId===pA.id){ pA.colors.push('W'); pB.colors.push('B'); } else { pA.colors.push('B'); pB.colors.push('W'); }
    }
    if(floated.length){
      if(gi+1 < groups.length) groups[gi+1].players = groups[gi+1].players.concat(floated);
      else group.leftover = (group.leftover||[]).concat(floated);
    }
  }

  // leftovers & unpaired
  const leftovers = (groups.length ? groups[groups.length-1].leftover || [] : []);
  const pairedIds = new Set();
  allPairings.forEach(p => { if(p.whiteId) pairedIds.add(p.whiteId); if(p.blackId) pairedIds.add(p.blackId); });
  const unpaired = players.filter(p => !pairedIds.has(p.id)).concat(leftovers);

  while(unpaired.length >= 2){
    const a = unpaired.shift();
    let idx = unpaired.findIndex(x => !havePlayed(a, x));
    if(idx === -1) idx = 0;
    const b = unpaired.splice(idx,1)[0];
    const pA = players.find(p=>p.id===a.id)||a;
    const pB = players.find(p=>p.id===b.id)||b;
    const {whiteId,blackId} = chooseColorsForPair(pA,pB);
    allPairings.push({whiteId,blackId,isBye:false,result:null,tdNote:null});
    if(!pA.opponents) pA.opponents = [];
    if(!pB.opponents) pB.opponents = [];
    if(!pA.opponents.includes(pB.id)) pA.opponents.push(pB.id);
    if(!pB.opponents.includes(pA.id)) pB.opponents.push(pA.id);
    pA.colors=pA.colors||[]; pB.colors=pB.colors||[];
    if(whiteId===pA.id){ pA.colors.push('W'); pB.colors.push('B'); } else { pA.colors.push('B'); pB.colors.push('W'); }
  }

  const remaining = players.filter(p=>!allPairings.some(pi=>pi.whiteId===p.id||pi.blackId===p.id));
  if(remaining.length===1){
    remaining.sort((a,b)=>a.score-b.score || (a.rating||0)-(b.rating||0));
    const candidate = remaining.find(p=>!p.hadBye) || remaining[0];
    allPairings.push({ whiteId:candidate.id, blackId:null, isBye:true, result:"1-0", tdNote:"auto-bye" });
    const idx = players.findIndex(p=>p.id===candidate.id);
    if(idx>=0) players[idx].hadBye = true;
  } else if(remaining.length>1){
    while(remaining.length>=2){
      const a=remaining.shift(), b=remaining.shift();
      const pA=players.find(x=>x.id===a.id)||a, pB=players.find(x=>x.id===b.id)||b;
      const {whiteId,blackId} = chooseColorsForPair(pA,pB);
      allPairings.push({whiteId,blackId,isBye:false,result:null,tdNote:null});
    }
    if(remaining.length===1){
      const c=remaining.shift();
      allPairings.push({ whiteId:c.id, blackId:null, isBye:true, result:"1-0", tdNote:"auto-bye" });
    }
  }

  return { pairings: allPairings, players };
}

// Tie-breaks: Buchholz (Solkoff), Modified Median, SB, cumulative
function computeTieBreaks(players) {
  const byId = new Map(players.map(p => [p.id, p]));
  players.forEach(p => { p.opponents = p.opponents || []; p.results = p.results || []; });

  players.forEach(p => {
    const oppScores = p.opponents.map(id => byId.get(id)?.score || 0).sort((a,b)=>a-b);
    const buch = oppScores.reduce((s,v)=>s+v,0);
    let median = buch;
    if(oppScores.length > 2) median = buch - oppScores[0] - oppScores[oppScores.length-1];
    let sb = 0;
    (p.results || []).forEach(r => {
      if(r.isBye) return;
      const opp = byId.get(r.oppId);
      if(!opp) return;
      if(r.result === 1) sb += opp.score;
      else if (r.result === 0.5) sb += opp.score / 2;
    });
    let run = 0, cum = 0;
    const sorted = (p.results || []).slice().sort((a,b)=>a.round-b.round);
    sorted.forEach(r => { run += r.result; cum += run; });
    p.buchholz = +buch.toFixed(3);
    p.median = +median.toFixed(3);
    p.sb = +sb.toFixed(3);
    p.cumulative = +cum.toFixed(3);
  });
}

// -------------------- Google Sheets helpers (using gapi) --------------------
async function initGapiClient() {
  return new Promise((resolve, reject) => {
    gapi.load("client:auth2", async () => {
      try {
        await gapi.client.init({
          apiKey: API_KEY,
          clientId: CLIENT_ID,
          discoveryDocs: ["https://sheets.googleapis.com/$discovery/rest?version=v4"],
          scope: SCOPES,
        });
        resolve();
      } catch (err) {
        reject(err);
      }
    });
  });
}

async function sheetsGet(range) {
  // returns values array or []
  const res = await gapi.client.sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range,
  });
  return res.result.values || [];
}

async function sheetsBatchUpdate(requests) {
  // requests: array of requests for spreadsheets.batchUpdate
  return await gapi.client.sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    resource: { requests },
  });
}

async function sheetsUpdateValues(range, values, valueInputOption = "RAW") {
  return await gapi.client.sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range,
    valueInputOption,
    resource: { values },
  });
}

async function sheetsAppendValues(range, values, valueInputOption = "RAW") {
  return await gapi.client.sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range,
    valueInputOption,
    insertDataOption: "INSERT_ROWS",
    resource: { values },
  });
}

// Create sheet/tab with title
async function createSheet(title) {
  try {
    await sheetsBatchUpdate([{ addSheet: { properties: { title } } }]);
  } catch (err) {
    // ignore if exists
  }
}

// -------------------- High-level sheet model functions --------------------
// The app uses the following ranges:
// - "sections!A1:E" header: sectionId,name,uscfMode,plannedRounds,locked
// - players tab per section: players_{sectionId}!A1:H header as documented
// - rounds tab per section: rounds_{sectionId}!A1:F header

async function getSections() {
  const rows = await sheetsGet("sections!A2:E");
  return rows.map(r => ({
    sectionId: r[0],
    name: r[1],
    uscfMode: parseBool(r[2]),
    plannedRounds: parseNumber(r[3]),
    locked: parseBool(r[4]),
  }));
}

async function addSectionToSheet(sectionId, name, uscfMode = true, plannedRounds = 4) {
  await createSheet(`players_${sectionId}`);
  await createSheet(`rounds_${sectionId}`);
  // add headers if missing
  await sheetsUpdateValues(`players_${sectionId}!A1:H1`, [["id","name","uscfId","rating","score","opponents","colors","hadBye","withdrawn"]].slice(0,8));
  await sheetsUpdateValues(`rounds_${sectionId}!A1:G1`, [["roundNumber","board","whiteId","blackId","result","isBye","tdNote"]]);
  // append to sections
  await sheetsAppendValues("sections!A2:E", [[sectionId, name, String(uscfMode), String(plannedRounds), "false"]]);
}

async function getPlayersFor(sectionId) {
  const rows = await sheetsGet(`players_${sectionId}!A2:H`);
  return rows.map(r => ({
    id: r[0],
    name: r[1],
    uscfId: r[2] || null,
    rating: parseNumber(r[3]),
    score: parseNumber(r[4]),
    opponents: safeSplit(r[5]),
    colors: safeSplit(r[6]),
    hadBye: parseBool(r[7]),
    withdrawn: false,
  }));
}

async function writePlayersFor(sectionId, players) {
  // overwrite players sheet (clear and set)
  const header = [["id","name","uscfId","rating","score","opponents","colors","hadBye","withdrawn"]].slice(0,8);
  const values = players.map(p => [p.id, p.name, p.uscfId || "", p.rating || 0, (p.score||0), safeJoin(p.opponents||[]), safeJoin(p.colors||[]), String(!!p.hadBye), String(!!p.withdrawn)]);
  // clear then write (we use update to range that can expand)
  await sheetsUpdateValues(`players_${sectionId}!A1:H${values.length+1}`, [header[0], ...values]);
}

async function appendRoundPairings(sectionId, roundNumber, pairings) {
  // pairings: array of { whiteId, blackId, isBye, result, tdNote }
  // append rows with board numbers
  const rows = pairings.map((p, idx) => [roundNumber, idx+1, p.whiteId, p.blackId || "", p.result || "", String(!!p.isBye), p.tdNote || ""]);
  await sheetsAppendValues(`rounds_${sectionId}!A2:G`, rows);
}

async function getRoundsFor(sectionId) {
  const rows = await sheetsGet(`rounds_${sectionId}!A2:G`);
  // group by roundNumber
  const roundsMap = new Map();
  rows.forEach(r => {
    const rn = parseNumber(r[0]);
    const board = parseNumber(r[1]);
    const whiteId = r[2];
    const blackId = r[3] || null;
    const result = r[4] || null;
    const isBye = parseBool(r[5]);
    const tdNote = r[6] || "";
    if(!roundsMap.has(rn)) roundsMap.set(rn, []);
    roundsMap.get(rn).push({ board, whiteId, blackId, result, isBye, tdNote });
  });
  return Array.from(roundsMap.entries()).sort((a,b)=>a[0]-b[0]).map(([number, pairings]) => ({ number, pairings }));
}

// Update a specific pairing result row: we must find exact row index in the sheet to update.
// Simpler: read entire rounds sheet, update the correct row value, and write back all rounds.
async function writeAllRounds(sectionId, rounds) {
  // flatten to rows
  const rows = [];
  rounds.forEach(r => {
    r.pairings.forEach((p) => rows.push([r.number, p.board || 0, p.whiteId, p.blackId || "", p.result || "", String(!!p.isBye), p.tdNote || ""]));
  });
  // write header + rows
  await sheetsUpdateValues(`rounds_${sectionId}!A1:G${rows.length+1}`, [["roundNumber","board","whiteId","blackId","result","isBye","tdNote"], ...rows]);
}

// -------------------- React App --------------------

export default function App() {
  const [signedIn, setSignedIn] = useState(false);
  const [profile, setProfile] = useState(null);
  const [sections, setSections] = useState([]);
  const [sectionData, setSectionData] = useState({}); // { sectionId: { players, rounds, meta } }
  const [tdMode, setTdMode] = useState(false);
  const pollRef = useRef(null);

  useEffect(() => {
    initGapiClient().then(() => {
      const auth = gapi.auth2.getAuthInstance();
      setSignedIn(auth.isSignedIn.get());
      auth.isSignedIn.listen((v) => setSignedIn(v));
      if(auth.isSignedIn.get()){
        const u = auth.currentUser.get().getBasicProfile();
        setProfile({ name: u.getName(), email: u.getEmail() });
      }
    }).catch(err => {
      console.error("gapi init err", err);
      alert("Failed to init Google API client. Check console.");
    });
    // initial load of sections
    (async () => {
      try {
        const secs = await getSections();
        setSections(secs);
        // preload each section's players & rounds
        const map = {};
        for(const s of secs){
          try{
            const players = await getPlayersFor(s.sectionId);
            const rounds = await getRoundsFor(s.sectionId);
            map[s.sectionId] = { players, rounds, meta: s };
          }catch(e){ map[s.sectionId] = { players: [], rounds: [], meta: s }; }
        }
        setSectionData(map);
      }catch(e){
        console.warn("Couldn't read sections tab - is it present?", e);
      }
    })();

    // cleanup on unmount
    return () => { if(pollRef.current) clearInterval(pollRef.current); };
  }, []);

  useEffect(() => {
    // start polling public view data every POLL_MS
    if(pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const secs = await getSections();
        setSections(secs);
        const map = {};
        for(const s of secs){
          try{
            const players = await getPlayersFor(s.sectionId);
            const rounds = await getRoundsFor(s.sectionId);
            map[s.sectionId] = { players, rounds, meta: s };
          }catch(e){ map[s.sectionId] = { players: [], rounds: [], meta: s }; }
        }
        setSectionData(map);
      } catch (e) {
        // ignore polling errors silently
      }
    }, POLL_MS);
    return () => clearInterval(pollRef.current);
  }, []);

  // Auth handlers
  const signIn = async () => {
    try {
      await gapi.auth2.getAuthInstance().signIn();
      const u = gapi.auth2.getAuthInstance().currentUser.get().getBasicProfile();
      setProfile({ name: u.getName(), email: u.getEmail() });
      setSignedIn(true);
    } catch (err) {
      console.error(err);
      alert("Sign-in failed");
    }
  };
  const signOut = async () => {
    await gapi.auth2.getAuthInstance().signOut();
    setSignedIn(false);
    setProfile(null);
  };

  // TD-only actions (require sign-in)
  async function createSectionLocal(name, uscf=true, plannedRounds=4) {
    const sectionId = `sec_${uid()}`;
    try {
      // create tabs and write to sections
      await addSectionToSheet(sectionId, name, uscf, plannedRounds);
      // reload sections
      const secs = await getSections();
      setSections(secs);
    } catch (err) { console.error(err); alert("Failed to create section: "+err.message); }
  }

  async function addPlayerLocal(sectionId, { name, uscfId="", rating=0 }) {
    const players = sectionData[sectionId]?.players || [];
    const newP = { id: `p_${uid()}`, name, uscfId, rating: Number(rating||0), score: 0, opponents: [], colors: [], hadBye: false, withdrawn: false };
    const newPlayers = [...players, newP];
    try {
      await writePlayersFor(sectionId, newPlayers);
      setSectionData(prev => ({ ...prev, [sectionId]: { ...(prev[sectionId]||{}), players: newPlayers } }));
    } catch (err) { console.error(err); alert("Failed to add player: "+err.message); }
  }

  async function lockSectionLocal(sectionId, plannedRounds = 4) {
    // update sections tab: find row and set locked true and plannedRounds
    // Simple approach: read sections, update local array then write back the sections tab entirely
    try {
      const secs = await getSections();
      const newSecs = secs.map(s => s.sectionId === sectionId ? { ...s, locked: true, plannedRounds } : s);
      const rows = newSecs.map(s => [s.sectionId, s.name, String(s.uscfMode), String(s.plannedRounds || 0), String(!!s.locked)]);
      await sheetsUpdateValues("sections!A1:E1", [["sectionId","name","uscfMode","plannedRounds","locked"]]);
      await sheetsUpdateValues(`sections!A2:E${rows.length+1}`, rows);
      setSections(newSecs);
    } catch (err) { console.error(err); alert("Failed to lock section: "+err.message); }
  }

  async function startNextRoundLocal(sectionId) {
    // get players -> run pairing engine -> append round rows and update players sheet for byes/opponents/colors
    const players = await getPlayersFor(sectionId);
    const { pairings, players: updatedPlayers } = uscfPairingEngine(players);
    // get rounds count
    const existingRounds = await getRoundsFor(sectionId);
    const nextRoundNumber = (existingRounds.length || 0) + 1;
    // write pairings
    await appendRoundPairings(sectionId, nextRoundNumber, pairings.map((p, idx) => ({ ...p, board: idx+1 })));
    // update players: credit byes immediately and update opponents/colors arrays
    const playersMap = Object.fromEntries(players.map(p => [p.id, p]));
    pairings.forEach((p) => {
      if(p.isBye){
        const pl = playersMap[p.whiteId];
        if(pl){
          pl.score = +( (pl.score || 0) + 1 ).toFixed(3); // full point bye
          pl.hadBye = true;
          pl.results = pl.results || [];
          pl.results.push({ round: nextRoundNumber, oppId: null, result: 1, isBye: true });
        }
      } else {
        const w = playersMap[p.whiteId];
        const b = playersMap[p.blackId];
        if(w && b){
          if(!w.opponents) w.opponents = [];
          if(!b.opponents) b.opponents = [];
          if(!w.opponents.includes(b.id)) w.opponents.push(b.id);
          if(!b.opponents.includes(w.id)) b.opponents.push(w.id);
          w.colors = w.colors || []; b.colors = b.colors || [];
          w.colors.push('W'); b.colors.push('B');
        }
      }
    });
    const newPlayers = Object.values(playersMap);
    await writePlayersFor(sectionId, newPlayers);
    // refresh local data
    const rounds = await getRoundsFor(sectionId);
    setSectionData(prev => ({ ...prev, [sectionId]: { ...(prev[sectionId]||{}), players: newPlayers, rounds } }));
  }

  async function updateResultLocal(sectionId, roundNumber, board, result) {
    // load rounds, find pairing, update result, then writeAllRounds and update players' scores and results
    try {
      const rounds = await getRoundsFor(sectionId);
      const players = await getPlayersFor(sectionId);
      const r = rounds.find(x => x.number === roundNumber);
      if(!r) throw new Error("Round not found");
      const pairing = r.pairings.find(p => p.board === board);
      if(!pairing) throw new Error("Board not found");
      // remove previous result pts if present
      const prev = pairing.result;
      function ptsFrom(res){ if(!res) return {w:0,b:0}; if(res==='1-0') return {w:1,b:0}; if(res==='0-1') return {w:0,b:1}; return {w:0.5,b:0.5}; }
      if(prev){
        const prevPts = ptsFrom(prev);
        if(pairing.isBye){
          const pw = players.find(pl => pl.id === pairing.whiteId);
          if(pw) pw.score = +(pw.score - prevPts.w).toFixed(3);
          // remove bye result entry
          if(pw) pw.results = (pw.results||[]).filter(rr => !(rr.round === roundNumber && rr.isBye));
        } else {
          const pw = players.find(pl => pl.id === pairing.whiteId);
          const pb = players.find(pl => pl.id === pairing.blackId);
          if(pw) { pw.score = +(pw.score - prevPts.w).toFixed(3); pw.results = (pw.results||[]).filter(rr => !(rr.round === roundNumber && rr.oppId === pairing.blackId)); }
          if(pb) { pb.score = +(pb.score - prevPts.b).toFixed(3); pb.results = (pb.results||[]).filter(rr => !(rr.round === roundNumber && rr.oppId === pairing.whiteId)); }
        }
      }
      // apply new result
      pairing.result = result;
      const pts = ptsFrom(result);
      if(pairing.isBye){
        const pw = players.find(pl => pl.id === pairing.whiteId);
        if(pw){ pw.score = +(pw.score + pts.w).toFixed(3); pw.results = pw.results || []; pw.results.push({ round: roundNumber, oppId:null, result: pts.w, isBye:true }); }
      } else {
        const pw = players.find(pl => pl.id === pairing.whiteId);
        const pb = players.find(pl => pl.id === pairing.blackId);
        if(pw){ pw.score = +(pw.score + pts.w).toFixed(3); pw.results = pw.results || []; pw.results.push({ round: roundNumber, oppId: pairing.blackId, result: pts.w, isBye:false }); }
        if(pb){ pb.score = +(pb.score + pts.b).toFixed(3); pb.results = pb.results || []; pb.results.push({ round: roundNumber, oppId: pairing.whiteId, result: pts.b, isBye:false }); }
      }
      // write back rounds and players
      // transform current rounds array to replace result in proper round/board
      const updatedRounds = rounds.map(rr => ({ number: rr.number, pairings: rr.pairings.map(pp => ({ ...pp })) }));
      for(const rr of updatedRounds){ if(rr.number === roundNumber){ for(const pp of rr.pairings){ if(pp.board === board){ pp.result = pairing.result; } } } }
      await writeAllRounds(sectionId, updatedRounds);
      await writePlayersFor(sectionId, players);
      // reload
      const newRounds = await getRoundsFor(sectionId);
      setSectionData(prev => ({ ...prev, [sectionId]: { ...(prev[sectionId]||{}), players, rounds: newRounds } }));
    } catch (err) {
      console.error(err); alert("Failed to update result: "+err.message);
    }
  }

  // TD override helpers (simple: edit pairing in rounds and write all rounds)
  async function tdSwapLocal(sectionId, roundNumber, board) {
    const rounds = await getRoundsFor(sectionId);
    const rr = rounds.find(r=>r.number===roundNumber);
    if(!rr) return alert("Round missing");
    const p = rr.pairings.find(pp=>pp.board===board);
    if(!p) return alert("Board missing");
    // swap white/black
    const tmp = p.whiteId; p.whiteId = p.blackId; p.blackId = tmp;
    // write back all rounds
    await writeAllRounds(sectionId, rounds);
    const players = await getPlayersFor(sectionId);
    setSectionData(prev => ({ ...prev, [sectionId]: { ...(prev[sectionId]||{}), players, rounds } }));
  }

  async function tdReplaceLocal(sectionId, roundNumber, board, which, newPlayerId) {
    const rounds = await getRoundsFor(sectionId);
    const rr = rounds.find(r=>r.number===roundNumber);
    if(!rr) return alert("Round missing");
    const p = rr.pairings.find(pp=>pp.board===board);
    if(!p) return alert("Board missing");
    if(which === 'white') p.whiteId = newPlayerId;
    else p.blackId = newPlayerId;
    await writeAllRounds(sectionId, rounds);
    const players = await getPlayersFor(sectionId);
    setSectionData(prev => ({ ...prev, [sectionId]: { ...(prev[sectionId]||{}), players, rounds } }));
  }

  // Printing helpers
  function printPairings(sectionId, roundNumber) {
    const sec = sectionData[sectionId];
    if(!sec) return;
    const round = sec.rounds.find(r=>r.number===roundNumber);
    if(!round) return;
    const html = [];
    html.push("<html><head><meta charset='utf-8'><title>Pairings</title>");
    html.push("<style>body{font-family:sans-serif;padding:20px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #222;padding:6px}th{background:#eee}</style>");
    html.push("</head><body>");
    html.push(`<h2>${escapeHtml(sec.meta.name)} — Round ${round.number}</h2>`);
    html.push("<table><thead><tr><th>Board</th><th>White</th><th>Black</th><th>Result</th></tr></thead><tbody>");
    round.pairings.forEach((p,i)=>{
      const w = sec.players.find(x=>x.id===p.whiteId);
      const b = p.blackId? sec.players.find(x=>x.id===p.blackId): null;
      html.push(`<tr><td>${i+1}</td><td>${escapeHtml(w? w.name : '—')}</td><td>${escapeHtml(b? b.name : (p.isBye?'BYE':'—'))}</td><td>${escapeHtml(p.result||'')}</td></tr>`);
    });
    html.push("</tbody></table></body></html>");
    const w = window.open("", "_blank");
    w.document.write(html.join("")); w.document.close(); w.focus(); w.print();
  }

  // compute standings with round-by-round cells
  function computeStandingsGrid(sectionId) {
    const sec = sectionData[sectionId];
    if(!sec) return [];
    const players = JSON.parse(JSON.stringify(sec.players || []));
    computeTieBreaks(players);
    players.sort((a,b) => {
      if((b.score||0)!==(a.score||0)) return (b.score||0)-(a.score||0);
      if((b.buchholz||0)!==(a.buchholz||0)) return (b.buchholz||0)-(a.buchholz||0);
      if((b.median||0)!==(a.median||0)) return (b.median||0)-(a.median||0);
      if((b.sb||0)!==(a.sb||0)) return (b.sb||0)-(a.sb||0);
      if((b.cumulative||0)!=(a.cumulative||0)) return (b.cumulative||0)-(a.cumulative||0);
      return (b.rating||0)-(a.rating||0);
    });
    // map id->rank after sort
    const idxById = {}; players.forEach((p,i) => idxById[p.id] = i+1);
    // build per-round cells
    const totalRounds = (sec.rounds || []).length;
    players.forEach(p => {
      p.roundCells = [];
      let running = 0;
      for(let r=0;r<totalRounds;r++){
        const round = sec.rounds[r];
        const pairing = round.pairings.find(pp => pp.whiteId===p.id || pp.blackId===p.id || (pp.isBye && pp.whiteId===p.id));
        if(!pairing){ p.roundCells.push({ label:'—', pts:running }); continue; }
        const isWhite = pairing.whiteId === p.id;
        const oppId = pairing.isBye ? null : (isWhite ? pairing.blackId : pairing.whiteId);
        const oppIdx = oppId ? (idxById[oppId] || '') : '';
        const res = pairing.result || (pairing.isBye ? "1-0" : null);
        let label = '';
        if(pairing.isBye && pairing.whiteId===p.id) { label = 'B'; running += 1; }
        else if(res) {
          if(res === '1-0'){ label = isWhite ? `W${oppIdx}` : `L${oppIdx}`; running += isWhite ? 1 : 0; }
          else if(res === '0-1'){ label = isWhite ? `L${oppIdx}` : `W${oppIdx}`; running += isWhite ? 0 : 1; }
          else { label = `D${oppIdx}`; running += 0.5; }
        } else {
          label = oppIdx ? `v${oppIdx}` : '—';
        }
        p.roundCells.push({ label, pts: +running.toFixed(2) });
      }
    });
    return players;
  }

  // -------------------- UI --------------------
  return (
    <div className="min-h-screen bg-gray-100 p-6">
      <div className="max-w-7xl mx-auto">
        <header className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold">WinTD-like (Google Sheets backend)</h1>
            <div className="text-sm text-gray-600">TD dashboard + public view (polling)</div>
          </div>
          <div className="flex items-center gap-3">
            {signedIn ? (
              <>
                <div className="text-sm">Signed in: {profile?.email}</div>
                <button onClick={signOut} className="px-3 py-2 bg-gray-200 rounded">Sign out</button>
              </>
            ) : (
              <button onClick={signIn} className="px-3 py-2 bg-blue-600 text-white rounded">TD Sign-in</button>
            )}
            <label className="text-sm flex items-center gap-2">
              <input type="checkbox" checked={tdMode} onChange={e=>setTdMode(e.target.checked)} /> TD Mode
            </label>
          </div>
        </header>

        <div className="mb-4">
          <button onClick={() => createSectionLocal("Open", true, 4)} className="px-3 py-2 bg-indigo-600 text-white rounded mr-2">Add USCF Section</button>
          <button onClick={() => createSectionLocal("Casual", false, 4)} className="px-3 py-2 bg-green-600 text-white rounded">Add Non-USCF Section</button>
        </div>

        <div className="grid gap-4">
          {sections.map(s => {
            const secData = sectionData[s.sectionId] || { players: [], rounds: [], meta: s };
            const standings = computeStandingsGrid(s.sectionId);
            return (
              <div key={s.sectionId} className="bg-white p-4 rounded shadow">
                <div className="flex justify-between items-center">
                  <div>
                    <h2 className="font-semibold">{s.name} {s.uscfMode?"(USCF)":""}</h2>
                    <div className="text-xs text-gray-600">Players: {secData.players.length} · Rounds: {secData.rounds.length} · Locked: {String(s.locked)}</div>
                  </div>
                  <div className="flex gap-2">
                    {tdMode && <button onClick={() => addPlayerLocal(s.sectionId, { name: "Quick Player "+uid().slice(0,4), rating: 1200 })} className="px-2 py-1 bg-blue-200 rounded">Quick Add</button>}
                    {tdMode && <button onClick={() => lockSectionLocal(s.sectionId, s.plannedRounds || 4)} className="px-2 py-1 bg-yellow-500 rounded text-white">Lock</button>}
                    {tdMode && <button onClick={() => startNextRoundLocal(s.sectionId)} className="px-2 py-1 bg-purple-600 text-white rounded">Start Next Round</button>}
                    <button onClick={() => { const win = window.open("", "_blank"); win.document.write("<pre>Share this sheet: "+SPREADSHEET_ID+"</pre>"); }} className="px-2 py-1 bg-gray-200 rounded">Sheet ID</button>
                  </div>
                </div>

                {/* players quick list */}
                <div className="mt-3">
                  <div className="text-sm font-semibold">Players</div>
                  <ul className="mt-2 grid grid-cols-2 md:grid-cols-4 gap-2">
                    {secData.players.map(p => <li key={p.id} className="border p-2 rounded">{p.name} <div className="text-xs text-gray-500">{p.rating}</div></li>)}
                  </ul>
                </div>

                {/* rounds */}
                <div className="mt-4">
                  <div className="text-sm font-semibold mb-2">Rounds</div>
                  {secData.rounds.map((r) => (
                    <div key={r.number} className="mb-3 border rounded p-2 bg-gray-50">
                      <div className="flex justify-between items-center mb-2">
                        <div className="font-semibold">Round {r.number}</div>
                        <div className="flex gap-2">
                          <button onClick={() => printPairings(s.sectionId, r.number)} className="px-2 py-1 bg-gray-500 text-white rounded">Print</button>
                        </div>
                      </div>
                      <table className="w-full border-collapse">
                        <thead>
                          <tr><th className="border px-2 py-1">Board</th><th className="border px-2 py-1">White</th><th className="border px-2 py-1">Black</th><th className="border px-2 py-1">Result</th><th className="border px-2 py-1">TD</th></tr>
                        </thead>
                        <tbody>
                          {r.pairings.map((p, idx) => {
                            const w = secData.players.find(x=>x.id===p.whiteId);
                            const b = p.blackId ? secData.players.find(x=>x.id===p.blackId) : null;
                            return (
                              <tr key={idx}>
                                <td className="border px-2 py-1">{p.board || idx+1}</td>
                                <td className="border px-2 py-1">{w? w.name : '—'}</td>
                                <td className="border px-2 py-1">{b? b.name : (p.isBye? 'BYE':'—')}</td>
                                <td className="border px-2 py-1">
                                  {p.isBye ? <span>1-0 (bye)</span> : (
                                    tdMode ? (
                                      <select value={p.result||''} onChange={e => updateResultLocal(s.sectionId, r.number, p.board||idx+1, e.target.value)}>
                                        <option value="">Select</option>
                                        <option value="1-0">1-0</option>
                                        <option value="0-1">0-1</option>
                                        <option value="0.5-0.5">0.5-0.5</option>
                                      </select>
                                    ) : <span>{p.result||''}</span>
                                  )}
                                </td>
                                <td className="border px-2 py-1">
                                  {tdMode && !p.isBye && <button onClick={() => tdSwapLocal(s.sectionId, r.number, p.board||idx+1)} className="px-2 py-1 bg-yellow-200 rounded text-sm mr-1">Swap</button>}
                                  {tdMode && <button onClick={() => { const which = prompt("Which side to replace? white|black"); const id = prompt("New player ID"); if(which && id) tdReplaceLocal(s.sectionId, r.number, p.board||idx+1, which, id); }} className="px-2 py-1 bg-red-200 rounded text-sm">Replace</button>}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  ))}
                </div>

                {/* standings grid */}
                <div className="mt-4">
                  <h3 className="font-semibold">Standings</h3>
                  <div className="overflow-auto">
                    <table className="w-full border-collapse">
                      <thead>
                        <tr>
                          <th className="border px-2 py-1">#</th>
                          <th className="border px-2 py-1">Player</th>
                          {(secData.rounds || []).map((_,i) => <th key={i} className="border px-2 py-1">R{i+1}</th>)}
                          <th className="border px-2 py-1">Pts</th>
                          <th className="border px-2 py-1">Buchholz</th>
                          <th className="border px-2 py-1">SB</th>
                        </tr>
                      </thead>
                      <tbody>
                        {standings.map((p,i) => (
                          <tr key={p.id} className={i===0 ? 'bg-amber-50':''}>
                            <td className="border px-2 py-1">{i+1}</td>
                            <td className="border px-2 py-1">{p.name}</td>
                            {p.roundCells.map((c,ci) => (<td key={ci} className="border px-2 py-1"><div>{c.label}</div><div className="text-xs text-gray-500">{c.pts.toFixed(2)}</div></td>))}
                            <td className="border px-2 py-1">{(p.score||0).toFixed(2)}</td>
                            <td className="border px-2 py-1">{(p.buchholz||0).toFixed(2)}</td>
                            <td className="border px-2 py-1">{(p.sb||0).toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

              </div>
            );
          })}
        </div>

      </div>
    </div>
  );
}
