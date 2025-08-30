import React from "react";

export default function PairingsTable({ pairings, enterResult }) {
  return (
    <table border="1">
      <thead>
        <tr>
          <th>Board</th><th>White</th><th>Black</th><th>Result</th>
        </tr>
      </thead>
      <tbody>
        {pairings.map((p, i) => (
          <tr key={i}>
            <td>{i + 1}</td>
            <td>{p.white?.name}</td>
            <td>{p.black?.name || "BYE"}</td>
            <td>
              <button onClick={() => enterResult(i, "1-0")}>1-0</button>
              <button onClick={() => enterResult(i, "0-1")}>0-1</button>
              <button onClick={() => enterResult(i, "½-½")}>½-½</button>
              {p.result}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
