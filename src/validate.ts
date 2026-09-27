import type { FamilyData, FamilyTree } from './types';

/** Checks the file as a whole: every tree needs its own uid and a name. */
export function validateData(data: FamilyData): string[] {
  const problems: string[] = [];
  if (!Array.isArray(data.trees)) return ['El archivo tiene que tener una lista "trees".'];
  const uids = new Set<string>();
  data.trees.forEach((tree, i) => {
    if (!tree.uid) problems.push(`El árbol número ${i + 1} no tiene "uid".`);
    else if (uids.has(tree.uid)) problems.push(`El uid "${tree.uid}" está repetido.`);
    else uids.add(tree.uid);
    if (!tree.name) problems.push(`El árbol "${tree.uid ?? i + 1}" no tiene "name".`);
  });
  return problems;
}

/** Returns human-readable problems in the data. An empty array means the file is consistent. */
export function validateTree(tree: FamilyTree): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  for (const p of tree.people) {
    if (p.gender != null && !['female', 'male', 'other'].includes(p.gender))
      problems.push(`El género de "${p.id}" tiene que ser "female", "male", "other" o null.`);
    if (p.nationality !== undefined && !Array.isArray(p.nationality))
      problems.push(`La nacionalidad de "${p.id}" tiene que ser una lista, por ejemplo ["argentina"].`);
    if (ids.has(p.id)) problems.push(`El id de persona "${p.id}" está repetido.`);
    ids.add(p.id);
  }
  const childOf = new Map<string, string>();
  const unionIds = new Set<string>();
  for (const u of tree.unions) {
    if (unionIds.has(u.id)) problems.push(`El id de unión "${u.id}" está repetido.`);
    unionIds.add(u.id);
    if (u.partners.length < 1 || u.partners.length > 2)
      problems.push(`La unión "${u.id}" tiene que tener 1 o 2 integrantes.`);
    for (const id of [...u.partners, ...u.children])
      if (!ids.has(id)) problems.push(`La unión "${u.id}" menciona a una persona que no existe: "${id}".`);
    for (const c of u.children) {
      const prev = childOf.get(c);
      if (prev) problems.push(`"${c}" figura como hijo/a en "${prev}" y también en "${u.id}".`);
      childOf.set(c, u.id);
      if (u.partners.includes(c)) problems.push(`"${c}" figura como integrante y como hijo/a en "${u.id}".`);
    }
  }
  return problems;
}
