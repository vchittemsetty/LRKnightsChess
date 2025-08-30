import React, { useState, useEffect } from "react";
import { loadPlayers, savePairings, saveResult } from "./googleSheets";
import PairingsTable from "./PairingsTable";

export default function TDSectionManager({ section }) {
  const [players, setPlayers] = useState([]);
  const [round, setRound] = useState(1);
  const [pairings, setPairings] = useState([]);

  useEffect(() => {
    loadPlayers(section).then(setPlayers);
  }, [section]);

  const generatePairings = () => {
    const sorted = [...players].sort((a, b) =>
      b.score - a.score || b.rating - a.rating
    );

    let newPairings = [];
    while (sorted.length > 1) {
      const white = sorted.shift();
      const black = sorted.shift();
      newPairings.push({ white, black, result: "" });
    }
    if (sorted.length === 1) {
      newPairings.push({ white: sorted[0], black: null, result: "BYE" });
    }

    setPairings(newPairings);
    savePairings(section, round, newPairings);
  };

  const enterResult = (i, result) => {
    let updated = [...pairings];
    updated[i].result = result;
    setPairings(updated);
    saveResult(section, round, updated[i]);
  };

  return (
    <div>
      <h2>{section} – Round {round}</h2>
      <button onClick={generatePairings}>Generate Pairings</button>
      <PairingsTable pairings={pairings} enterResult={enterResult} />
    </div>
  );
}
