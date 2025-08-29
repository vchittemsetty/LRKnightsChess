// src/services/pairingEngine.js
// Exported functions:
// - uscfPairingEngine(players) -> { pairings, players: updatedPlayers }
// - computeTieBreaks(players) -> modifies players with buchholz/median/sb/cumulative

export function uid() {
  return Math.random().toString(36).slice(2, 9);
}

function seedCompare(a, b) {
  if ((b.rating || 0) !== (a.rating || 0)) return (b.rating || 0) - (a.rating || 0);
  return a.name.localeCompare(b.name);
}

function havePlayed(a, b) {
  if (!a || !b) return false;
  return (a.opponents || []).includes(b.id);
}

function chooseColorsForPair(pA, pB) {
  const aW = (pA.colors || []).filter((c) => c === "W").length;
  const aB = (pA.colors || []).filter((c) => c === "B").length;
  const bW = (pB.colors || []).filter((c) => c === "W").length;
  const bB = (pB.colors || []).filter((c) => c === "B").length;
  const aLast = (pA.colors || []).slice(-2).join("");
  const bLast = (pB.colors || []).slice(-2).join("");

  if (aLast === "WW" && bLast !== "WW") return { whiteId: pB.id, blackId: pA.id };
  if (aLast === "BB" && bLast !== "BB") return { whiteId: pA.id, blackId: pB.id };
  if (bLast === "WW" && aLast !== "WW") return { whiteId: pA.id, blackId: pB.id };
  if (bLast === "BB" && aLast !== "BB") return { whiteId: pB.id, blackId: pA.id };

  if (aW <= aB && bW > bB) return { whiteId: pA.id, blackId: pB.id };
  if (bW <= bB && aW > aB) return { whiteId: pB.id, blackId: pA.id };

  if ((pA.rating || 0) > (pB.rating || 0)) return { whiteId: pB.id, blackId: pA.id };
  return { whiteId: pA.id, blackId: pB.id };
}

// Build score groups and pair within them (pragmatic USCF approach).
export function uscfPairingEngine(playersRaw = []) {
  // playersRaw: array of player objects { id, name, rating, score, opponents: [], colors: [], hadBye, withdrawn }
  const players = JSON.parse(JSON.stringify(playersRaw)).filter((p) => !p.withdrawn);
  players.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if ((b.rating || 0) !== (a.rating || 0)) return (b.rating || 0) - (a.rating || 0);
    return a.name.localeCompare(b.name);
  });

  // Build score groups
  const byScore = new Map();
  players.forEach((p) => {
    const key = p.score.toFixed(3);
    if (!byScore.has(key)) byScore.set(key, []);
    byScore.get(key).push(p);
  });
  const groups = Array.from(byScore.entries())
    .map(([score, list]) => ({ score: +score, players: list }))
    .sort((a, b) => b.score - a.score);
  groups.forEach((g) => g.players.sort(seedCompare));

  let allPairings = [];

  // pair within groups & float as needed (pragmatic greedy pairing)
  for (let gi = 0; gi < groups.length; gi++) {
    const group = groups[gi];
    const playersInGroup = group.players.slice();
    const topCount = Math.ceil(playersInGroup.length / 2);
    const top = playersInGroup.slice(0, topCount);
    let bottom = playersInGroup.slice(topCount);

    const pairingsInGroup = [];
    const floated = [];

    for (let i = 0; i < top.length; i++) {
      const t = top[i];
      if (i >= bottom.length) {
        floated.push(t);
        continue;
      }
      let chosenIdx = -1;
      for (let j = i; j < bottom.length; j++) {
        if (!havePlayed(t, bottom[j])) {
          chosenIdx = j;
          break;
        }
      }
      if (chosenIdx === -1) {
        for (let j = 0; j < bottom.length; j++) {
          if (!bottom[j]._used) {
            chosenIdx = j;
            break;
          }
        }
      }
      if (chosenIdx === -1) {
        floated.push(t);
        continue;
      }
      const chosen = bottom.splice(chosenIdx, 1)[0];
      // choose colors
      const pA = players.find((x) => x.id === t.id) || t;
      const pB = players.find((x) => x.id === chosen.id) || chosen;
      const { whiteId, blackId } = chooseColorsForPair(pA, pB);

      pairingsInGroup.push({ whiteId, blackId, isBye: false, result: null, tdNote: null });

      // update local opponents/colors for next pairing decisions
      if (!pA.opponents) pA.opponents = [];
      if (!pB.opponents) pB.opponents = [];
      if (!pA.opponents.includes(pB.id)) pA.opponents.push(pB.id);
      if (!pB.opponents.includes(pA.id)) pB.opponents.push(pA.id);
      pA.colors = pA.colors || [];
      pB.colors = pB.colors || [];
      if (whiteId === pA.id) {
        pA.colors.push("W");
        pB.colors.push("B");
      } else {
        pA.colors.push("B");
        pB.colors.push("W");
      }
    }

    allPairings.push(...pairingsInGroup);

    if (floated.length) {
      if (gi + 1 < groups.length) {
        groups[gi + 1].players = groups[gi + 1].players.concat(floated);
      } else {
        // leftover floats - will handle later
        groups[gi].leftover = (groups[gi].leftover || []).concat(floated);
      }
    }
  }

  // collect unpaired leftovers and pair them greedy
  const leftoverPlayers = [];
  groups.forEach((g) => {
    if (g.leftover) leftoverPlayers.push(...g.leftover);
  });

  // determine currently paired ids
  const pairedIds = new Set();
  allPairings.forEach((p) => {
    if (p.whiteId) pairedIds.add(p.whiteId);
    if (p.blackId) pairedIds.add(p.blackId);
  });

  const unpaired = players.filter((p) => !pairedIds.has(p.id)).concat(leftoverPlayers);

  while (unpaired.length >= 2) {
    const a = unpaired.shift();
    let idx = unpaired.findIndex((x) => !havePlayed(a, x));
    if (idx === -1) idx = 0;
    const b = unpaired.splice(idx, 1)[0];
    const pA = players.find((p) => p.id === a.id) || a;
    const pB = players.find((p) => p.id === b.id) || b;
    const { whiteId, blackId } = chooseColorsForPair(pA, pB);
    allPairings.push({ whiteId, blackId, isBye: false, result: null, tdNote: null });

    if (!pA.opponents) pA.opponents = [];
    if (!pB.opponents) pB.opponents = [];
    if (!pA.opponents.includes(pB.id)) pA.opponents.push(pB.id);
    if (!pB.opponents.includes(pA.id)) pB.opponents.push(pA.id);
    pA.colors = pA.colors || [];
    pB.colors = pB.colors || [];
    if (whiteId === pA.id) {
      pA.colors.push("W");
      pB.colors.push("B");
    } else {
      pA.colors.push("B");
      pB.colors.push("W");
    }
  }

  // If one remains -> bye
  const remaining = players.filter((p) => !allPairings.some((pi) => pi.whiteId === p.id || pi.blackId === p.id));
  if (remaining.length === 1) {
    // lowest eligible (lowest score then lowest rating)
    remaining.sort((a, b) => a.score - b.score || (a.rating || 0) - (b.rating || 0));
    const candidate = remaining.find((p) => !p.hadBye) || remaining[0];
    allPairings.push({ whiteId: candidate.id, blackId: null, isBye: true, result: "1-0", tdNote: "auto-bye" });
    const pidx = players.findIndex((p) => p.id === candidate.id);
    if (pidx >= 0) players[pidx].hadBye = true;
  }

  return { pairings: allPairings, players };
}

// tiebreaks based on players array (players should include .opponents and .results)
export function computeTieBreaks(players) {
  const byId = new Map(players.map((p) => [p.id, p]));
  players.forEach((p) => {
    p.opponents = p.opponents || [];
    p.results = p.results || [];
  });
  players.forEach((p) => {
    const oppScores = p.opponents.map((id) => byId.get(id)?.score || 0).sort((a, b) => a - b);
    const buch = oppScores.reduce((s, v) => s + v, 0);
    let median = buch;
    if (oppScores.length > 2) median = buch - oppScores[0] - oppScores[oppScores.length - 1];
    let sb = 0;
    (p.results || []).forEach((r) => {
      if (r.isBye) return;
      const opp = byId.get(r.oppId);
      if (!opp) return;
      if (r.result === 1) sb += opp.score;
      else if (r.result === 0.5) sb += opp.score / 2;
    });
    let run = 0;
    let cum = 0;
    const sorted = (p.results || []).slice().sort((a, b) => a.round - b.round);
    sorted.forEach((r) => {
      run += r.result;
      cum += run;
    });
    p.buchholz = +buch.toFixed(3);
    p.median = +median.toFixed(3);
    p.sb = +sb.toFixed(3);
    p.cumulative = +cum.toFixed(3);
  });
}
