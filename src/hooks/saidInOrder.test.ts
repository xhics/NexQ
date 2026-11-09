import { expect, it } from "vitest";
import { clauses, covered, saidInOrder } from "./useSaidSinceAnswer";
import { contentWords } from "../stores/storyStore";

it("counts a word said with another ending", () => {
  const said = contentWords("je privilégie des déploiements progressifs et une conception résiliente");
  expect(covered("Je privilégie le déploiement progressif.", said)).toBe(true);
  expect(covered("La résilience des systèmes critiques.", said)).toBe(false);
});

it("marks what comes before the last part you said, said in your own words or not", () => {
  const answer = "J'ai d'abord isolé la panne dans les logs. Ensuite on a coupé le flux temporairement. Enfin j'ai renforcé la reprise sur erreur.";
  // Said the first in other words, then the second as written.
  const isSaid = saidInOrder(answer, contentWords("alors j'ai cherché où ça cassait, ensuite on a coupé le flux temporairement"));
  expect(isSaid("J'ai d'abord isolé la panne dans les logs.")).toBe(true);
  expect(isSaid("Ensuite on a coupé le flux temporairement.")).toBe(true);
  expect(isSaid("Enfin j'ai renforcé la reprise sur erreur.")).toBe(false);
});

it("cuts at commas, not inside a number", () => {
  expect(clauses("J'ai migré la CI, réduit le build de 3,5 min, puis automatisé les tests.")).toEqual([
    "J'ai migré la CI, ",
    "réduit le build de 3,5 min, ",
    "puis automatisé les tests.",
  ]);
});

it("marks the answer up to the comma you reached, not the whole sentence", () => {
  const answer = "J'ai isolé la panne dans les journaux applicatifs, coupé le flux Kafka temporairement, puis renforcé la reprise sur erreur.";
  const isSaid = saidInOrder(answer, contentWords("j'ai isolé la panne dans les journaux applicatifs"));
  expect(isSaid("J'ai isolé la panne dans les journaux applicatifs, ")).toBe(true);
  expect(isSaid("coupé le flux Kafka temporairement, ")).toBe(false);
});
