// googleSheets.js

export async function loadPlayers(section) {
  // Mock players
  return [
    { name: "Alice", rating: 1500, score: 0 },
    { name: "Bob", rating: 1450, score: 0 },
    { name: "Charlie", rating: 1400, score: 0 }
  ];
}

export async function savePairings(section, round, pairings) {
  console.log("Saving pairings:", section, round, pairings);
}

export async function saveResult(section, round, pairing) {
  console.log("Saving result:", section, round, pairing);
}

export async function loadStandings(section) {
  return [
    { name: "Alice", r1: "1", r2: "0", r3: "½", total: 1.5, tb1: 3, tb2: 2 },
    { name: "Bob", r1: "0", r2: "1", r3: "½", total: 1.5, tb1: 2, tb2: 1 },
    { name: "Charlie", r1: "½", r2: "½", r3: "1", total: 2.0, tb1: 4, tb2: 3 }
  ];
}
