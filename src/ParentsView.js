import React, { useState, useEffect } from "react";
import { loadStandings } from "./googleSheets";
import StandingsTable from "./StandingsTable";

export default function ParentsView({ section }) {
  const [standings, setStandings] = useState([]);

  useEffect(() => {
    loadStandings(section).then(setStandings);
  }, [section]);

  return (
    <div>
      <h2>{section} Standings</h2>
      <StandingsTable standings={standings} />
    </div>
  );
}
