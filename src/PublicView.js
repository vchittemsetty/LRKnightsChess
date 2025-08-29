// src/PublicView.jsx
import React, { useEffect, useState } from "react";
import { subscribeAllSections, subscribeSectionData } from "./services/firestoreService";

export default function PublicView({ tournamentId }) {
  const [sections, setSections] = useState([]);
  const [sectionContent, setSectionContent] = useState({}); // keyed by sectionId

  useEffect(() => {
    if (!tournamentId) return;
    const unsubSections = subscribeAllSections(tournamentId, (arr) => {
      setSections(arr);
    });

    const unsubMap = {};
    const subs = {};
    function setup(sec) {
      if (unsubMap[sec.id]) return;
      unsubMap[sec.id] = subscribeSectionData(tournamentId, sec.id, {
        onSectionDocChange: (meta) => setSectionContent((s) => ({ ...s, [sec.id]: { ...(s[sec.id]||{}), meta } })),
        onPlayersChange: (players) => setSectionContent((s) => ({ ...s, [sec.id]: { ...(s[sec.id]||{}), players } })),
        onRoundsChange: (rounds) => setSectionContent((s) => ({ ...s, [sec.id]: { ...(s[sec.id]||{}), rounds } })),
      });
    }

    // whenever sections change, register listeners for new ones
    const unsubWatch = subscribeAllSections(tournamentId, (arr) => {
      arr.forEach(setup);
    });

    return () => {
      unsubSections();
      unsubWatch();
      Object.values(unsubMap).forEach((u) => u && u());
    };
  }, [tournamentId]);

  return (
    <div>
      <h1>Public View</h1>
      {sections.map((s) => {
        const content = sectionContent[s.id] || {};
        const players = content.players || [];
        const rounds = content.rounds || [];
        return (
          <section key={s.id}>
            <h2>{s.name}</h2>
            {/* render pairings & standings (read-only) */}
          </section>
        );
      })}
    </div>
  );
}
