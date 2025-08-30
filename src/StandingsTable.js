import React from "react";

export default function StandingsTable({ standings }) {
  return (
    <table border="1">
      <thead>
        <tr>
          <th>Name</th>
          <th>R1</th><th>R2</th><th>R3</th>
          <th>Total</th>
          <th>TB1</th><th>TB2</th>
        </tr>
      </thead>
      <tbody>
        {standings.map((p, i) => (
          <tr key={i}>
            <td>{p.name}</td>
            <td>{p.r1}</td>
            <td>{p.r2}</td>
            <td>{p.r3}</td>
            <td>{p.total}</td>
            <td>{p.tb1}</td>
            <td>{p.tb2}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
