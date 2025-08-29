// src/services/firestoreService.js
import {
  collection,
  doc,
  addDoc,
  setDoc,
  getDocs,
  getDoc,
  onSnapshot,
  writeBatch,
  updateDoc,
  runTransaction,
  serverTimestamp,
  query,
  orderBy,
} from "firebase/firestore";
import { db } from "../firebase";
import { uscfPairingEngine, computeTieBreaks } from "./pairingEngine";

// ------------------- helpers -------------------
function tournamentsCol() { return collection(db, "tournaments"); }
function sectionsCol(tournamentId) { return collection(db, "tournaments", tournamentId, "sections"); }
function playersCol(tournamentId, sectionId) { return collection(db, "tournaments", tournamentId, "sections", sectionId, "players"); }
function roundsCol(tournamentId, sectionId) { return collection(db, "tournaments", tournamentId, "sections", sectionId, "rounds"); }

// ------------------- tournament/section CRUD -------------------

// Create a tournament (returns docRef.id)
export async function createTournament(name = "Default Tournament") {
  const ref = await addDoc(tournamentsCol(), {
    name,
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

// Create a section (returns sectionId)
export async function createSection(tournamentId, { name = "Open", uscfMode = true }) {
  const ref = await addDoc(sectionsCol(tournamentId), {
    name,
    uscfMode,
    locked: false,
    plannedRounds: 0,
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

// Real-time subscription of all sections metadata. callback gets array of { id, ...data }
export function subscribeAllSections(tournamentId, callback) {
  const q = sectionsCol(tournamentId);
  const unsub = onSnapshot(q, (snap) => {
    const arr = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    callback(arr);
  });
  return unsub;
}

// Subscribe to players and rounds for a given section (returns unsubscribe)
export function subscribeSectionData(tournamentId, sectionId, handlers) {
  // handlers: { onPlayersChange, onRoundsChange, onSectionDocChange }
  const sectionDoc = doc(db, "tournaments", tournamentId, "sections", sectionId);
  const unsubSection = onSnapshot(sectionDoc, (sd) => {
    if (handlers?.onSectionDocChange) handlers.onSectionDocChange({ id: sd.id, ...sd.data() });
  });

  const playersQ = playersCol(tournamentId, sectionId);
  const unsubPlayers = onSnapshot(playersQ, (snap) => {
    const players = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    if (handlers?.onPlayersChange) handlers.onPlayersChange(players);
  });

  const roundsQ = query(roundsCol(tournamentId, sectionId), orderBy("number", "asc"));
  const unsubRounds = onSnapshot(roundsQ, (snap) => {
    const rounds = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    if (handlers?.onRoundsChange) handlers.onRoundsChange(rounds);
  });

  return () => {
    unsubSection();
    unsubPlayers();
    unsubRounds();
  };
}

// ------------------- players -------------------

// Add player (creates document in players subcollection)
export async function addPlayer(tournamentId, sectionId, playerData) {
  const p = {
    name: playerData.name,
    uscfId: playerData.uscfId || null,
    rating: Number(playerData.rating || 0),
    score: 0,
    opponents: [],
    colors: [],
    results: [],
    hadBye: false,
    withdrawn: false,
    createdAt: serverTimestamp(),
  };
  const ref = await addDoc(playersCol(tournamentId, sectionId), p);
  return ref.id;
}

// ------------------- lock & start rounds -------------------
export async function lockSection(tournamentId, sectionId, plannedRounds = 4) {
  const secRef = doc(db, "tournaments", tournamentId, "sections", sectionId);
  await updateDoc(secRef, { locked: true, plannedRounds });
}

// Start next round: compute pairings client-side, then write a new round doc and update players in a batch.
export async function startNextRound(tournamentId, sectionId) {
  // fetch all players
  const playersSnap = await getDocs(playersCol(tournamentId, sectionId));
  const players = playersSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

  // call pairing engine
  const { pairings } = uscfPairingEngine(players);

  // determine next round number
  const roundsSnapshot = await getDocs(roundsCol(tournamentId, sectionId));
  const nextRoundNumber = (roundsSnapshot.size || 0) + 1;

  // create a new round doc and update players using a batch
  const batch = writeBatch(db);
  const newRoundRef = doc(roundsCol(tournamentId, sectionId)); // doc with generated id
  batch.set(newRoundRef, {
    number: nextRoundNumber,
    pairings,
    createdAt: serverTimestamp(),
  });

  // apply immediate changes: for byes credit 1 point and push result entry
  // For non-byes: add opponents & colors to each player's doc (scores remain until result entered)
  players.forEach((p) => {
    const playerRef = doc(db, "tournaments", tournamentId, "sections", sectionId, "players", p.id);
    // find if p has bye in this round
    const bye = pairings.find((pp) => pp.isBye && pp.whiteId === p.id);
    if (bye) {
      const newScore = (p.score || 0) + 1;
      const results = Array.isArray(p.results) ? p.results.slice() : [];
      results.push({ round: nextRoundNumber, oppId: null, result: 1, isBye: true });
      batch.update(playerRef, { score: newScore, hadBye: true, results, updatedAt: serverTimestamp() });
    } else {
      // update opponents and colors if present in pairings
      const pOppos = (p.opponents || []).slice();
      const pColors = (p.colors || []).slice();
      pairings.forEach((pp) => {
        if (!pp.isBye) {
          if (pp.whiteId === p.id && !pOppos.includes(pp.blackId)) pOppos.push(pp.blackId);
          if (pp.blackId === p.id && !pOppos.includes(pp.whiteId)) pOppos.push(pp.whiteId);
          if (pp.whiteId === p.id) pColors.push("W");
          if (pp.blackId === p.id) pColors.push("B");
        }
      });
      batch.update(playerRef, { opponents: pOppos, colors: pColors, updatedAt: serverTimestamp() });
    }
  });

  await batch.commit();
  return newRoundRef.id;
}

// ------------------- update result atomic -------------------
export async function updateResult(tournamentId, sectionId, roundId, pairingIndex, newResult) {
  const roundRef = doc(db, "tournaments", tournamentId, "sections", sectionId, "rounds", roundId);

  await runTransaction(db, async (tx) => {
    const roundSnap = await tx.get(roundRef);
    if (!roundSnap.exists()) throw new Error("Round not found");
    const round = roundSnap.data();
    const pairing = round.pairings[pairingIndex];
    if (!pairing) throw new Error("Pairing not found");

    const whiteRef = doc(db, "tournaments", tournamentId, "sections", sectionId, "players", pairing.whiteId);
    const blackRef = pairing.blackId ? doc(db, "tournaments", tournamentId, "sections", sectionId, "players", pairing.blackId) : null;
    const whiteSnap = await tx.get(whiteRef);
    const blackSnap = blackRef ? await tx.get(blackRef) : null;
    const pW = whiteSnap.exists() ? whiteSnap.data() : null;
    const pB = blackSnap && blackSnap.exists() ? blackSnap.data() : null;

    // remove previous points if any
    const prev = pairing.result;
    function ptsFromStr(res) {
      if (!res) return { w: 0, b: 0 };
      if (res === "1-0") return { w: 1, b: 0 };
      if (res === "0-1") return { w: 0, b: 1 };
      if (res === "0.5-0.5" || res === "½-½") return { w: 0.5, b: 0.5 };
      return { w: 0, b: 0 };
    }
    if (prev) {
      const prevPts = ptsFromStr(prev);
      if (pW) {
        const newScore = +( (pW.score || 0) - prevPts.w ).toFixed(3);
        const newResults = (pW.results || []).filter((r) => !(r.round === round.number && r.oppId === pairing.blackId && r.isBye === !!pairing.isBye));
        tx.update(whiteRef, { score: newScore, results: newResults });
      }
      if (pB) {
        const newScore = +( (pB.score || 0) - prevPts.b ).toFixed(3);
        const newResults = (pB.results || []).filter((r) => !(r.round === round.number && r.oppId === pairing.whiteId));
        tx.update(blackRef, { score: newScore, results: newResults });
      }
    }

    // apply new points
    const newPts = ptsFromStr(newResult);
    if (pairing.isBye) {
      // bye -> white gets pts.w
      if (!pW) throw new Error("Player missing");
      const newScore = +( (pW.score || 0) + newPts.w ).toFixed(3);
      const newResults = (pW.results || []).filter((r) => !(r.round === round.number && r.isBye));
      newResults.push({ round: round.number, oppId: null, result: newPts.w, isBye: true });
      tx.update(whiteRef, { score: newScore, results: newResults });
    } else {
      if (!pW || !pB) throw new Error("Both players must exist");
      const newScoreW = +( (pW.score || 0) + newPts.w ).toFixed(3);
      const newScoreB = +( (pB.score || 0) + newPts.b ).toFixed(3);
      const newResultsW = (pW.results || []).filter((r) => !(r.round === round.number && r.oppId === pairing.blackId));
      const newResultsB = (pB.results || []).filter((r) => !(r.round === round.number && r.oppId === pairing.whiteId));
      newResultsW.push({ round: round.number, oppId: pairing.blackId, result: newPts.w, isBye: false });
      newResultsB.push({ round: round.number, oppId: pairing.whiteId, result: newPts.b, isBye: false });
      tx.update(whiteRef, { score: newScoreW, results: newResultsW });
      tx.update(blackRef, { score: newScoreB, results: newResultsB });
    }

    // update round pairing result
    const updatedPairings = (round.pairings || []).slice();
    updatedPairings[pairingIndex] = { ...updatedPairings[pairingIndex], result: newResult };
    tx.update(roundRef, { pairings: updatedPairings });
  });
}

// ------------------- TD override helpers -------------------

// Swap players on a particular board: swap whiteId/blackId and optionally adjust colors/opponents marginally.
// NB: TD should verify after swapping; we do a simple swap on the round document.
export async function tdSwapPlayers(tournamentId, sectionId, roundId, boardIndex, note = "TD swap") {
  const roundRef = doc(db, "tournaments", tournamentId, "sections", sectionId, "rounds", roundId);
  await runTransaction(db, async (tx) => {
    const rSnap = await tx.get(roundRef);
    if (!rSnap.exists()) throw new Error("Round not found");
    const round = rSnap.data();
    const pairing = round.pairings[boardIndex];
    if (!pairing) throw new Error("Pairing not found");
    const swapped = { ...pairing, whiteId: pairing.blackId, blackId: pairing.whiteId, tdNote: (pairing.tdNote || "") + " | " + note };
    const newPairings = round.pairings.slice();
    newPairings[boardIndex] = swapped;
    tx.update(roundRef, { pairings: newPairings });
  });
}

// Replace a player on a board (TD override)
export async function tdReplacePlayer(tournamentId, sectionId, roundId, boardIndex, which, newPlayerId, note = "TD replace") {
  const roundRef = doc(db, "tournaments", tournamentId, "sections", sectionId, "rounds", roundId);
  await runTransaction(db, async (tx) => {
    const rSnap = await tx.get(roundRef);
    if (!rSnap.exists()) throw new Error("Round not found");
    const round = rSnap.data();
    const pairing = round.pairings[boardIndex];
    if (!pairing) throw new Error("Pairing not found");
    const updated = { ...pairing };
    if (which === "white") updated.whiteId = newPlayerId;
    else updated.blackId = newPlayerId;
    updated.tdNote = (updated.tdNote || "") + " | " + note;
    const newPairings = round.pairings.slice();
    newPairings[boardIndex] = updated;
    tx.update(roundRef, { pairings: newPairings });
  });
}

// Force color (set whiteId to particular player)
export async function tdForceColor(tournamentId, sectionId, roundId, boardIndex, whitePlayerId, note = "TD force color") {
  const roundRef = doc(db, "tournaments", tournamentId, "sections", sectionId, "rounds", roundId);
  await runTransaction(db, async (tx) => {
    const rSnap = await tx.get(roundRef);
    if (!rSnap.exists()) throw new Error("Round not found");
    const round = rSnap.data();
    const pairing = round.pairings[boardIndex];
    if (!pairing) throw new Error("Pairing not found");
    const updated = { ...pairing };
    if (updated.whiteId !== whitePlayerId) {
      // swap
      const prevWhite = updated.whiteId;
      updated.whiteId = whitePlayerId;
      updated.blackId = prevWhite;
    }
    updated.tdNote = (updated.tdNote || "") + " | " + note;
    const newPairings = round.pairings.slice();
    newPairings[boardIndex] = updated;
    tx.update(roundRef, { pairings: newPairings });
  });
}

// ------------------- export/import helpers -------------------
export async function exportSection(tournamentId, sectionId) {
  // get section doc, players, rounds and produce JSON
  const sectionRef = doc(db, "tournaments", tournamentId, "sections", sectionId);
  const secSnap = await getDoc(sectionRef);
  if (!secSnap.exists()) throw new Error("Section not found");
  const section = { id: secSnap.id, ...secSnap.data() };
  const playersSnap = await getDocs(playersCol(tournamentId, sectionId));
  section.players = playersSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const roundsSnap = await getDocs(roundsCol(tournamentId, sectionId));
  section.rounds = roundsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  return section;
}

export async function importSection(tournamentId, sectionPayload) {
  // creates a new section with given payload (players and rounds become subcollections)
  const sectRef = await addDoc(sectionsCol(tournamentId), {
    name: sectionPayload.name || "Imported",
    uscfMode: !!sectionPayload.uscfMode,
    locked: !!sectionPayload.locked,
    plannedRounds: sectionPayload.plannedRounds || 0,
    createdAt: serverTimestamp(),
  });
  const sectionId = sectRef.id;
  const batch = writeBatch(db);
  // create player docs
  (sectionPayload.players || []).forEach((p) => {
    const pRef = doc(playersCol(tournamentId, sectionId));
    batch.set(pRef, { ...p, createdAt: serverTimestamp() });
  });
  // create rounds
  (sectionPayload.rounds || []).forEach((r) => {
    const rRef = doc(roundsCol(tournamentId, sectionId));
    batch.set(rRef, { ...r, createdAt: serverTimestamp() });
  });
  await batch.commit();
  return sectionId;
}
